/**
 * Ciclo de automações de um projeto (Etapa 3B):
 *   tarefas (quadro, 3A) + sinais (2D) → snapshot → eventos (diff com o salvo no SQLite) →
 *   regras → ações (mover pela fila da 3A, notificar) → histórico.
 *
 * Idempotência: cada evento tem uma chave única por projeto e tarefa em task_events. Chave, estado
 * local, escrita pendente no Notion e o novo snapshot são gravados na MESMA transação: um evento
 * nunca dispara duas vezes, nem depois de reiniciar, e uma falha no Notion não perde a mudança.
 */
import type { EventPr, TaskEventDetailInput } from '../../shared/task-events'
import {
  EVENT_META,
  deriveEvents,
  evaluate,
  mergeSnapshot,
  toSnapshot,
  type AutomationDecision,
  type AutomationEvent,
  type EventKind,
  type TaskSnapshot
} from '../../shared/automation'
import type { BoardService } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import type { OrkioConfig } from '../config/orkio-config'
import type { ConfigStore } from '../storage/config-store'
import type { BoardView } from '../../shared/board'
import type { Result } from '../../shared/result'
import type { TaskSignalsResult } from '../../shared/task-signals'
import { projectById } from '../config/queries'
import { readRepoOf } from '../../shared/projects'

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
    get(projectId: string, options?: { force?: boolean }): Promise<Result<TaskSignalsResult>>
  }
  notify(notification: AutomationNotification): void
  onChanged(projectId: string): void
  now?: () => Date
}

export interface CycleResult {
  github: TaskSignalsResult['github'] | 'unknown'
  events: number
  moves: number
  error?: { code: string; message: string }
}

export class AutomationService {
  private readonly now: () => Date
  private running = new Map<string, { promise: Promise<CycleResult>; force: boolean }>()

  constructor(private readonly deps: AutomationServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Um ciclo por projeto de cada vez (chamadas simultâneas esperam o mesmo ciclo). "Atualizar"
   * (force) durante um ciclo comum não pode devolver o resultado velho: espera e roda um forçado.
   */
  run(projectId: string, options: { force?: boolean } = {}): Promise<CycleResult> {
    const force = options.force === true
    const current = this.running.get(projectId)
    if (current) {
      if (!force || current.force) return current.promise
      return current.promise.then(
        () => this.run(projectId, { force: true }),
        () => this.run(projectId, { force: true })
      )
    }
    const promise = this.cycle(projectId, force).finally(() => {
      this.running.delete(projectId)
    })
    this.running.set(projectId, { promise, force })
    return promise
  }

  private async cycle(projectId: string, force: boolean): Promise<CycleResult> {
    const config = this.deps.config.get()
    const board = config.boards[projectId]
    if (!board) return { github: 'unknown', events: 0, moves: 0 }

    const view = await this.deps.board.get(projectId, { force })
    if (!view.ok && !this.deps.board.hasSnapshot(projectId)) {
      return { github: 'unknown', events: 0, moves: 0, error: view.error }
    }
    const cards = view.ok ? view.value.cards : null

    const signals = await this.deps.signals.get(projectId, { force })
    if (!signals.ok) return { github: 'unknown', events: 0, moves: 0, error: signals.error }
    const result = signals.value
    const available = { local: result.local, github: result.github === 'ok' }

    const previous = this.deps.store.snapshots(projectId)
    const states = this.deps.store.states(projectId)
    const stages = (view.ok ? view.value.config?.stages : null) ?? board.stages
    const taskIds = cards ? cards.map((c) => c.taskId) : [...states.keys()]
    const at = this.now().toISOString()
    const repo = readRepoOf(projectById(config, projectId))
    const pr = (n: number): EventPr =>
      repo ? { number: n, owner: repo.owner, repo: repo.name } : { number: n }
    const notifications: AutomationNotification[] = []
    let eventCount = 0
    let moves = 0

    this.deps.store.transaction((tx) => {
      for (const taskId of taskIds) {
        const prev = (previous.get(taskId) as TaskSnapshot | undefined) ?? null
        const fresh = toSnapshot(result.signals[taskId], available)
        const events = deriveEvents(taskId, prev, fresh).filter(
          (e) => !this.deps.store.hasEventKey(projectId, taskId, e.key)
        )
        this.deps.store.saveSnapshot(taskId, projectId, mergeSnapshot(prev, fresh), at)
        if (events.length === 0) continue

        const r = this.decideAndApply(tx, projectId, taskId, events, {
          rules: board.rules,
          stages,
          globallyPaused: config.automation.paused,
          at,
          pr,
          onNotify: (d) =>
            notifications.push(this.notification(projectId, taskId, d, cards, stages))
        })
        eventCount += r.events
        moves += r.moves
      }
    })

    if (moves > 0) this.deps.board.flushWrites()
    if (eventCount > 0) this.deps.onChanged(projectId)
    for (const n of notifications) this.deps.notify(n)
    return { github: result.github, events: eventCount, moves }
  }

  /**
   * Um evento que o próprio Orkio causou e o GitHub não vai acusar (ex.: pedir de novo a revisão a
   * quem já estava pendente): passa pelas mesmas regras, pausas e histórico de um ciclo. Devolve se
   * moveu a tarefa.
   */
  applyEvent(projectId: string, taskId: string, kind: EventKind, prNumber: number): boolean {
    const config = this.deps.config.get()
    const board = config.boards[projectId]
    if (!board) return false
    const at = this.now().toISOString()
    const repo = readRepoOf(projectById(config, projectId))
    const pr = (n: number): EventPr =>
      repo ? { number: n, owner: repo.owner, repo: repo.name } : { number: n }
    const event: AutomationEvent = {
      key: `orkio:${kind}:${taskId}:${at}`,
      kind,
      taskId,
      at,
      pr: { number: prNumber }
    }
    const r = this.deps.store.transaction((tx) =>
      this.decideAndApply(tx, projectId, taskId, [event], {
        rules: board.rules,
        stages: board.stages,
        globallyPaused: config.automation.paused,
        at,
        pr,
        onNotify: (d) =>
          this.deps.notify(this.notification(projectId, taskId, d, null, board.stages))
      })
    )
    if (r.moves > 0) this.deps.board.flushWrites()
    this.deps.onChanged(projectId)
    return r.moves > 0
  }

  /** Regras → movimento (ou registro no histórico) de uma tarefa, dentro da transação de quem chama. */
  private decideAndApply(
    tx: Parameters<AutomationServiceDeps['board']['applyAutomationMove']>[0],
    projectId: string,
    taskId: string,
    events: readonly AutomationEvent[],
    ctx: {
      rules: OrkioConfig['boards'][string]['rules']
      stages: Parameters<typeof evaluate>[3]
      globallyPaused: boolean
      at: string
      pr: (n: number) => EventPr
      onNotify: (d: AutomationDecision) => void
    }
  ): { events: number; moves: number } {
    let eventCount = 0
    let moves = 0
    const state = this.deps.store.state(taskId)
    const decisions = evaluate(
      events,
      ctx.rules,
      {
        stageId: state?.stageId ?? null,
        blocked: state?.blocked ?? false,
        paused: state?.automationPaused ?? false,
        lastManualMoveAt: this.deps.store.lastManualMoveAt(taskId)
      },
      ctx.stages,
      { globallyPaused: ctx.globallyPaused }
    )
    for (const d of decisions) {
      eventCount++
      const detail: TaskEventDetailInput<'automation'> = {
        event: d.event.kind,
        ruleId: d.ruleId,
        ruleName: d.ruleName,
        outcome: d.outcome,
        ...(d.reason ? { reason: d.reason } : {}),
        ...(d.event.branch ? { branch: d.event.branch } : {}),
        ...(d.event.pr ? { pr: ctx.pr(d.event.pr.number) } : {})
      }
      let moved = false
      if (d.outcome === 'move' && d.to) {
        try {
          moved = this.deps.board.applyAutomationMove(tx, projectId, taskId, d.to, {
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
          at: ctx.at,
          kind: 'automation',
          fromStage: d.from,
          toStage: detail.outcome === 'skipped' ? d.to : null,
          detail,
          eventKey: d.event.key
        })
      }
      if (d.notify && (moved || d.outcome === 'notify')) ctx.onNotify(d)
    }
    return { events: eventCount, moves }
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
      ? `${EVENT_META[d.event.kind].label} (PR #${d.event.pr.number})`
      : EVENT_META[d.event.kind].label
    const stage = stages.find((s) => s.id === d.to)?.name
    return {
      projectId,
      taskId,
      title: stage ? `${id} → ${stage}` : id,
      body: d.message ?? what
    }
  }
}
