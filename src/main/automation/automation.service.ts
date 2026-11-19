/**
 * Ciclo de automações de um projeto (Etapa 3B):
 *   tarefas (quadro, 3A) + sinais (2D) → snapshot → eventos (diff com o salvo no SQLite) →
 *   regras → ações (mover pela fila da 3A, notificar) → histórico.
 *
 * Idempotência: cada evento tem uma chave única em task_events. Chave, estado local, escrita
 * pendente no Notion e o novo snapshot são gravados na MESMA transação: um evento nunca dispara
 * duas vezes, nem depois de reiniciar, e uma falha no Notion não perde a mudança (fica pendente).
 */
import {
  EVENT_LABELS,
  deriveEvents,
  evaluate,
  mergeSnapshot,
  toSnapshot,
  type AutomationDecision,
  type TaskSnapshot
} from '../../shared/automation'
import type { BoardView, NotionResult, TaskSignalsResult } from '../../shared/ipc-contract'
import type { BoardService } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import type { OrkioConfig } from '../config/orkio-config'
import type { ConfigStore } from '../storage/config-store'

export interface AutomationNotification {
  projectId: string
  taskId: string
  title: string
  body: string
}

export interface AutomationServiceDeps {
  config: ConfigStore<OrkioConfig>
  store: BoardStore
  board: Pick<BoardService, 'get' | 'applyAutomationMove' | 'flushWrites' | 'hasSnapshot'>
  signals: {
    get(projectId: string, options?: { force?: boolean }): Promise<NotionResult<TaskSignalsResult>>
  }
  notify(notification: AutomationNotification): void
  /** Algo mudou no quadro do projeto (a tela recarrega). */
  onChanged(projectId: string): void
  now?: () => Date
}

export interface CycleResult {
  /** Situação do GitHub neste ciclo (para o agendador decidir pausa/backoff). */
  github: TaskSignalsResult['github'] | 'unknown'
  events: number
  moves: number
  /** Erro que impediu o ciclo (ex.: Notion fora do ar e tarefas nunca carregadas). */
  error?: { code: string; message: string }
}

export class AutomationService {
  private readonly now: () => Date
  private running = new Map<string, Promise<CycleResult>>()

  constructor(private readonly deps: AutomationServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Um ciclo por projeto de cada vez (chamadas simultâneas esperam o mesmo ciclo). */
  run(projectId: string, options: { force?: boolean } = {}): Promise<CycleResult> {
    let current = this.running.get(projectId)
    if (!current) {
      current = this.cycle(projectId, options.force === true).finally(() => {
        this.running.delete(projectId)
      })
      this.running.set(projectId, current)
    }
    return current
  }

  private async cycle(projectId: string, force: boolean): Promise<CycleResult> {
    const config = this.deps.config.get()
    const board = config.boards[projectId]
    if (!board) return { github: 'unknown', events: 0, moves: 0 }

    // 1. Tarefas e reconciliação com o Notion (mesmo caminho do quadro).
    const view = await this.deps.board.get(projectId, { force })
    if (!view.ok && !this.deps.board.hasSnapshot(projectId)) {
      return { github: 'unknown', events: 0, moves: 0, error: view.error }
    }
    const cards = view.ok ? view.value.cards : null

    // 2. Sinais (git local + GitHub com ETag).
    const signals = await this.deps.signals.get(projectId, { force })
    if (!signals.ok) return { github: 'unknown', events: 0, moves: 0, error: signals.error }
    const result = signals.value
    const available = { local: result.local, github: result.github === 'ok' }

    // 3. Diff + regras + ações, tarefa a tarefa, numa transação só.
    const previous = this.deps.store.snapshots(projectId)
    const states = this.deps.store.states(projectId)
    const stages = (view.ok ? view.value.config?.stages : null) ?? board.stages
    const taskIds = cards ? cards.map((c) => c.taskId) : [...states.keys()]
    const at = this.now().toISOString()
    const repo = config.projects.find((p) => p.id === projectId)?.repo ?? null
    // Só o necessário para montar o link da PR no histórico.
    const pr = (n: number): Record<string, unknown> =>
      repo && repo.host.toLowerCase() === 'github.com'
        ? { number: n, owner: repo.owner, repo: repo.name }
        : { number: n }
    const notifications: AutomationNotification[] = []
    let eventCount = 0
    let moves = 0

    this.deps.store.transaction(() => {
      for (const taskId of taskIds) {
        const prev = (previous.get(taskId) as TaskSnapshot | undefined) ?? null
        const fresh = toSnapshot(result.signals[taskId], available)
        const events = deriveEvents(taskId, prev, fresh).filter(
          (e) => !this.deps.store.hasEventKey(e.key)
        )
        this.deps.store.saveSnapshot(taskId, projectId, mergeSnapshot(prev, fresh), at)
        if (events.length === 0) continue

        const state = this.deps.store.state(taskId)
        const decisions = evaluate(
          events,
          board.rules,
          {
            stageId: state?.stageId ?? null,
            blocked: state?.blocked ?? false,
            paused: state?.automationPaused ?? false,
            lastManualMoveAt: this.deps.store.lastManualMoveAt(taskId)
          },
          stages,
          { globallyPaused: config.automation.paused }
        )
        for (const d of decisions) {
          eventCount++
          const detail: Record<string, unknown> = {
            event: d.event.kind,
            ruleId: d.ruleId,
            ruleName: d.ruleName,
            outcome: d.outcome,
            ...(d.reason ? { reason: d.reason } : {}),
            ...(d.event.branch ? { branch: d.event.branch } : {}),
            ...(d.event.pr ? { pr: pr(d.event.pr.number) } : {})
          }
          let moved = false
          if (d.outcome === 'move' && d.to) {
            try {
              moved = this.deps.board.applyAutomationMove(projectId, taskId, d.to, {
                key: d.event.key,
                detail
              })
            } catch {
              // Etapa removida ou tarefa fora do quadro: registra como ignorada.
              detail.outcome = 'skipped'
              detail.reason = 'não foi possível mover a tarefa'
            }
          }
          if (moved) {
            moves++
          } else {
            this.deps.store.addEvent({
              taskPageId: taskId,
              projectId,
              at,
              kind: 'automation',
              source: 'automation',
              fromStage: d.from,
              toStage: detail.outcome === 'skipped' ? d.to : null,
              detail,
              eventKey: d.event.key
            })
          }
          if (d.notify && (moved || d.outcome === 'notify')) {
            notifications.push(this.notification(projectId, taskId, d, cards, stages))
          }
        }
      }
    })

    if (moves > 0) this.deps.board.flushWrites()
    if (eventCount > 0) this.deps.onChanged(projectId)
    for (const n of notifications) this.deps.notify(n)
    return { github: result.github, events: eventCount, moves }
  }

  private notification(
    projectId: string,
    taskId: string,
    d: AutomationDecision,
    cards: BoardView['cards'] | null,
    stages: { id: string; name: string }[]
  ): AutomationNotification {
    const card = cards?.find((c) => c.taskId === taskId)
    const id = card?.displayId ?? 'Tarefa'
    const what = d.event.pr
      ? `${EVENT_LABELS[d.event.kind]} (PR #${d.event.pr.number})`
      : EVENT_LABELS[d.event.kind]
    const stage = stages.find((s) => s.id === d.to)?.name
    return {
      projectId,
      taskId,
      title: stage ? `${id} → ${stage}` : id,
      body: d.message ?? what
    }
  }
}
