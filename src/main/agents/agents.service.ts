/**
 * Agentes do Orkio (Etapa 8A): perfis em arquivos, aprovação dos perfis do repositório, atribuição
 * de tarefas (à mão ou pela regra da coluna) e limites diários.
 *
 * - Perfil do repositório: `<pasta do projeto>/.orkio/agents/<id>.md`. É a ÚNICA escrita do Orkio na
 *   pasta do projeto: escrita atômica, nunca commita. Lido sempre da pasta do projeto (nunca do
 *   worktree), então o Claude não muda o próprio agente no meio de uma tarefa.
 * - Perfil "só neste computador": `<userData>/agents/<id>.md`, vale em todos os projetos.
 * - Perfil do repositório alterado fora do Orkio (hash ≠ aprovado) → `needs_review`: não roda até
 *   você aprovar. Mesmo aprovado, ele não dá permissão nenhuma além das do Orkio.
 * - Nada de segredo: nome e instruções que a redação alteraria são recusados.
 * - Embutidos (8B, `builtin:<id>`): catálogo do app (`shared/agent-presets.ts`), só leitura e já
 *   aprovados; valem em todos os projetos. Para mudar, duplique (vira um perfil comum).
 */
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  AGENT_ID,
  ACTIVITY_HOURS,
  AGENT_LIMITS,
  agentInitials,
  agentKey,
  localDayStart,
  parseAgentFile,
  parseAgentKey,
  serializeAgent,
  validateAgent,
  type AgentBadge,
  type AgentKey,
  type AgentProfile,
  type AgentScope,
  type AgentsState,
  type AgentView,
  type ProjectAgents,
  type WritableAgentScope
} from '../../shared/agent'
import { BUILTIN_AGENTS, builtinAgent } from '../../shared/agent-presets'
import type { BoardStore } from '../board/board.store'
import type { StageChange } from '../board/board.service'
import type { OrkioConfig } from '../config/orkio-config'
import type { Db } from '../db/database'
import type { ConfigStore } from '../storage/config-store'
import { redactSecrets } from '../claude/redact'

export const AGENT_MESSAGES = {
  notFound: 'Agente não encontrado. Atualize a tela.',
  projectNotFound: 'Projeto não encontrado. Atualize a lista.',
  exists: 'Já existe um agente com esse id. Escolha outro nome ou id.',
  secret:
    'As instruções parecem conter um segredo (token, chave ou senha). Remova antes de salvar.',
  idChanged: 'O id de um agente não muda depois de criado. Use “Duplicar” para criar outro.',
  symlink: 'A pasta .orkio/agents do projeto é um link simbólico; o Orkio não grava nela.',
  writeFailed: 'Não foi possível gravar o perfil do agente. Confira as permissões da pasta.',
  busy: 'Esta tarefa tem um fluxo em andamento. Cancele ou espere terminar para trocar o agente.',
  invalid: 'O perfil deste agente tem erros. Corrija na tela Agentes.',
  archived: 'Este agente está arquivado.',
  needsReview: 'O perfil deste agente mudou no repositório. Revise e aprove na tela Agentes.',
  stale: 'O perfil mudou desde que você abriu. Atualize a tela e revise de novo.',
  builtin:
    'Os agentes embutidos não podem ser alterados. Use “Duplicar” para criar uma cópia editável.',
  badStage: 'Etapa não encontrada no quadro deste projeto.'
} as const

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/** Agente pronto para uma execução (a cópia do perfil vai junto com o fluxo). */
export interface AgentRuntime {
  key: AgentKey
  profile: AgentProfile
}

export interface AgentsServiceDeps {
  db: Db
  store: BoardStore
  config: ConfigStore<OrkioConfig>
  /** `<userData>/agents` (perfis "só neste computador"). */
  localDir: string
  /** Há fluxo ativo na tarefa? (troca de agente fica bloqueada). */
  hasActiveFlow(taskId: string): boolean
  /** Ids das etapas do quadro do projeto. */
  stageIds(projectId: string): string[]
  actor(): string
  emit(projectId: string): void
  now?: () => Date
}

interface FileEntry {
  scope: AgentScope
  id: string
  file: string
  text: string | null
  error: string | null
}

const FILE_NAME = /^([a-z0-9][a-z0-9-]{0,39})\.md$/
const MAX_FILES = 50

export class AgentsService {
  /** Nome de cada agente visto por último (para o histórico da regra da coluna, que é síncrona). */
  private readonly names = new Map<AgentKey, string>()

  constructor(private readonly deps: AgentsServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  // ---------- Leitura ----------

  async list(projectId: string): Promise<AgentsState> {
    const project = this.project(projectId)
    const entries = [
      ...(await this.readDir('repo', this.repoDir(project.localPath))),
      ...(await this.readDir('local', this.deps.localDir)),
      ...BUILTIN_AGENTS.map((p) => builtinEntry(p.id)!)
    ]
    const counts = new Map<string, number>()
    for (const r of this.deps.db.all<{ agent_key: string; n: number }>(
      'SELECT agent_key, COUNT(*) AS n FROM agent_assignments WHERE project_id = ? GROUP BY agent_key',
      projectId
    )) {
      counts.set(r.agent_key, r.n)
    }
    const agents = entries
      .map((e) => this.toView(projectId, e, counts.get(agentKey(e.scope, e.id)) ?? 0))
      .sort((a, b) => (a.profile?.name ?? a.id).localeCompare(b.profile?.name ?? b.id, 'pt-BR'))
    const config = this.deps.config.get()
    return {
      projectId,
      agents,
      rules: this.rules(projectId),
      stages: (config.boards[projectId]?.stages ?? []).map((st) => ({ id: st.id, name: st.name })),
      flows: (config.flows[projectId]?.flows ?? []).map((f) => ({ id: f.id, name: f.name }))
    }
  }

  /** Um agente (lido do disco agora). `null` = arquivo não existe. */
  async get(projectId: string, key: AgentKey): Promise<AgentView | null> {
    const parsed = parseAgentKey(key)
    if (!parsed) return null
    const project = this.project(projectId)
    const entry =
      parsed.scope === 'builtin'
        ? builtinEntry(parsed.id)
        : await this.readOne(
            parsed.scope,
            parsed.scope === 'repo' ? this.repoDir(project.localPath) : this.deps.localDir,
            parsed.id
          )
    if (!entry) return null
    const assigned =
      this.deps.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM agent_assignments WHERE project_id = ? AND agent_key = ?',
        projectId,
        key
      )?.n ?? 0
    return this.toView(projectId, entry, assigned)
  }

  /**
   * Agente da tarefa, pronto para rodar. `null` = sem agente. Lança `AgentError` (mensagem pt-BR)
   * quando há agente, mas ele não pode rodar (apagado, inválido, arquivado, sem aprovação).
   */
  async runtimeFor(projectId: string, taskId: string): Promise<AgentRuntime | null> {
    const key = this.assignedKey(taskId)
    if (!key) return null
    const view = await this.get(projectId, key)
    if (!view) throw new AgentError('not_found', 'O agente desta tarefa não existe mais.')
    return this.usable(view)
  }

  /** Mensagem do limite diário atingido (main), ou `null`. */
  limitProblem(runtime: AgentRuntime): string | null {
    const usage = this.usage(runtime.key)
    const { stepsPerDay, costPerDayUsd } = runtime.profile.limits
    const name = runtime.profile.name
    if (usage.runs >= stepsPerDay) {
      return `${name} atingiu o limite de hoje (${stepsPerDay} execuções do Claude Code).`
    }
    if (costPerDayUsd !== null && usage.costUsd >= costPerDayUsd) {
      return `${name} atingiu o limite de custo de hoje (US$ ${costPerDayUsd.toFixed(2)}).`
    }
    return null
  }

  usage(key: AgentKey): { runs: number; costUsd: number } {
    const since = localDayStart(this.now()).toISOString()
    const r = this.deps.db.get<{ n: number; cost: number | null }>(
      'SELECT COUNT(*) AS n, SUM(cost) AS cost FROM agent_runs WHERE agent_key = ? AND started_at >= ?',
      key,
      since
    )
    return { runs: r?.n ?? 0, costUsd: r?.cost ?? 0 }
  }

  /** Execuções por hora nas últimas `ACTIVITY_HOURS` horas (índice 0 = a mais antiga). */
  activity(key: AgentKey): number[] {
    const hour = 3_600_000
    const nowMs = this.now().getTime()
    const out = new Array<number>(ACTIVITY_HOURS).fill(0)
    for (const r of this.deps.db.all<{ started_at: string }>(
      'SELECT started_at FROM agent_runs WHERE agent_key = ? AND started_at >= ?',
      key,
      new Date(nowMs - ACTIVITY_HOURS * hour).toISOString()
    )) {
      const age = Math.floor((nowMs - Date.parse(r.started_at)) / hour)
      if (age >= 0 && age < ACTIVITY_HOURS) out[ACTIVITY_HOURS - 1 - age]! += 1
    }
    return out
  }

  assignedKey(taskId: string): AgentKey | null {
    return this.assignment(taskId)?.key ?? null
  }

  /** Agente da tarefa e se foi escolhido à mão (o orquestrador não passa por cima disso). */
  assignment(taskId: string): { key: AgentKey; manual: boolean } | null {
    const r = this.deps.db.get<{ agent_key: string; assigned_by: string }>(
      'SELECT agent_key, assigned_by FROM agent_assignments WHERE task_page_id = ?',
      taskId
    )
    return r ? { key: r.agent_key, manual: r.assigned_by === 'manual' } : null
  }

  /** Atribuições do projeto (tarefa → agente), para o orquestrador. */
  assignments(projectId: string): Map<string, { key: AgentKey; manual: boolean }> {
    const out = new Map<string, { key: AgentKey; manual: boolean }>()
    for (const r of this.deps.db.all<{
      task_page_id: string
      agent_key: string
      assigned_by: string
    }>(
      'SELECT task_page_id, agent_key, assigned_by FROM agent_assignments WHERE project_id = ?',
      projectId
    )) {
      out.set(r.task_page_id, { key: r.agent_key, manual: r.assigned_by === 'manual' })
    }
    return out
  }

  /**
   * 8B: o orquestrador atribui a tarefa. Síncrono e sem ler disco: chame dentro da transação do
   * movimento, ANTES de mover (o fluxo da coluna lê o agente ao começar).
   */
  assignByOrchestrator(projectId: string, taskId: string, key: AgentKey, name: string): void {
    if (this.assignedKey(taskId) === key) return
    this.insertAssignment(projectId, taskId, key, name, 'orchestrator')
  }

  /** Avatares dos cards do quadro. */
  async badges(projectId: string): Promise<Record<string, AgentBadge>> {
    const rows = this.deps.db.all<{ task_page_id: string; agent_key: string }>(
      'SELECT task_page_id, agent_key FROM agent_assignments WHERE project_id = ?',
      projectId
    )
    if (rows.length === 0) return {}
    const { agents } = await this.list(projectId)
    const out: Record<string, AgentBadge> = {}
    for (const r of rows) {
      const view = agents.find((a) => a.key === r.agent_key)
      const name = view?.profile?.name ?? parseAgentKey(r.agent_key)?.id ?? '?'
      out[r.task_page_id] = {
        key: r.agent_key,
        name,
        color: view?.profile?.color ?? 'yellow',
        initials: agentInitials(name),
        problem: !view
          ? 'O agente desta tarefa não existe mais.'
          : view.status === 'ready'
            ? null
            : this.statusMessage(view)
      }
    }
    return out
  }

  // ---------- Escrita ----------

  /**
   * Cria (`isNew`) ou atualiza um perfil. O id não muda depois de criado. Perfil do repositório
   * gravado pelo Orkio já fica aprovado (o hash é o do arquivo que você acabou de salvar).
   */
  async save(input: {
    projectId: string
    scope: AgentScope
    profile: AgentProfile
    isNew: boolean
  }): Promise<AgentView> {
    if (input.scope === 'builtin') throw new AgentError('builtin', AGENT_MESSAGES.builtin)
    const scope: WritableAgentScope = input.scope
    const project = this.project(input.projectId)
    const profile = normalize(input.profile)
    const errors = validateAgent(profile)
    if (errors.length > 0) throw new AgentError('invalid', errors.join(' '))
    if (
      redactSecrets(profile.instructions) !== profile.instructions ||
      redactSecrets(profile.name) !== profile.name
    ) {
      throw new AgentError('secret', AGENT_MESSAGES.secret)
    }
    const dir = scope === 'repo' ? this.repoDir(project.localPath) : this.deps.localDir
    const existing = await this.readOne(scope, dir, profile.id)
    if (input.isNew && existing) throw new AgentError('exists', AGENT_MESSAGES.exists)
    if (!input.isNew && !existing) throw new AgentError('not_found', AGENT_MESSAGES.notFound)
    const text = serializeAgent(profile)
    await this.writeAtomic(scope, dir, project.localPath, profile.id, text)
    const key = agentKey(scope, profile.id)
    if (scope === 'repo') this.trust(input.projectId, profile.id, hashOf(text))
    this.deps.store.addConfigEvent(input.projectId, this.now().toISOString(), this.deps.actor(), [
      `${input.isNew ? 'Agente criado' : profile.archived ? 'Agente arquivado' : 'Agente alterado'}: ${profile.name} (${scope === 'repo' ? 'repositório' : 'este computador'})`
    ])
    this.deps.emit(input.projectId)
    const view = await this.get(input.projectId, key)
    if (!view) throw new AgentError('write_failed', AGENT_MESSAGES.writeFailed)
    return view
  }

  /** Aprova o perfil do repositório exatamente como você o viu (`hash`). */
  async approve(projectId: string, key: AgentKey, hash: string): Promise<AgentView> {
    const view = await this.get(projectId, key)
    if (!view || view.scope !== 'repo') throw new AgentError('not_found', AGENT_MESSAGES.notFound)
    if (view.hash !== hash) throw new AgentError('stale', AGENT_MESSAGES.stale)
    if (!view.profile) throw new AgentError('invalid', AGENT_MESSAGES.invalid)
    this.trust(projectId, view.id, hash)
    this.deps.store.addConfigEvent(projectId, this.now().toISOString(), this.deps.actor(), [
      `Perfil do agente aprovado: ${view.profile.name} (repositório)`
    ])
    this.deps.emit(projectId)
    return (await this.get(projectId, key))!
  }

  /** Atribui (ou tira, com `key = null`) a tarefa a um agente. */
  async assign(projectId: string, taskId: string, key: AgentKey | null): Promise<void> {
    this.project(projectId)
    const current = this.assignedKey(taskId)
    if (current === key) return
    if (this.deps.hasActiveFlow(taskId)) throw new AgentError('busy', AGENT_MESSAGES.busy)
    if (key === null) {
      this.deps.store.transaction(() => {
        this.deps.db.run('DELETE FROM agent_assignments WHERE task_page_id = ?', taskId)
        this.taskEvent(projectId, taskId, 'agent_unassigned', {
          agentKey: current,
          agent: current ? (parseAgentKey(current)?.id ?? '') : '',
          by: 'manual'
        })
      })
      this.deps.emit(projectId)
      return
    }
    const view = await this.get(projectId, key)
    if (!view) throw new AgentError('not_found', AGENT_MESSAGES.notFound)
    if (view.status === 'invalid' || view.status === 'archived') {
      throw new AgentError(view.status, this.statusMessage(view))
    }
    this.deps.store.transaction(() =>
      this.insertAssignment(projectId, taskId, key, view.profile!.name, 'manual')
    )
    this.deps.emit(projectId)
  }

  /** Regras "tarefas que entram em <etapa> vão para <agente>". */
  async setRules(projectId: string, rules: ProjectAgents['assignOnEnter']): Promise<AgentsState> {
    this.project(projectId)
    const stages = new Set(this.deps.stageIds(projectId))
    const seen = new Set<string>()
    const names: string[] = []
    for (const r of rules) {
      if (!stages.has(r.stageId)) throw new AgentError('bad_stage', AGENT_MESSAGES.badStage)
      if (seen.has(r.stageId)) throw new AgentError('invalid', 'Uma etapa só pode ter um agente.')
      seen.add(r.stageId)
      const view = await this.get(projectId, r.agentKey)
      if (!view?.profile || view.status === 'invalid' || view.status === 'archived') {
        throw new AgentError('invalid', 'Escolha um agente válido para cada etapa.')
      }
      names.push(view.profile.name)
    }
    const before = this.rules(projectId)
    await this.deps.config.update((c) => ({
      ...c,
      agents: { ...c.agents, [projectId]: { assignOnEnter: rules.map((r) => ({ ...r })) } }
    }))
    if (JSON.stringify(before) !== JSON.stringify(rules)) {
      this.deps.store.addConfigEvent(projectId, this.now().toISOString(), this.deps.actor(), [
        rules.length === 0
          ? 'Regras de atribuição de agentes removidas'
          : `Regras de atribuição de agentes: ${names.join(', ')}`
      ])
    }
    this.deps.emit(projectId)
    return this.list(projectId)
  }

  /**
   * Do BoardService, dentro da transação do movimento: a regra da coluna atribui a tarefa (se ela
   * ainda não tem agente) ANTES de o fluxo da coluna começar. Só entrada real (manual/automação).
   */
  onStageChanged(change: StageChange): void {
    if (change.source !== 'manual' && change.source !== 'automation') return
    if (!change.to) return
    const rule = this.rules(change.projectId).find((r) => r.stageId === change.to)
    if (!rule) return
    if (this.assignedKey(change.taskId) || this.deps.hasActiveFlow(change.taskId)) return
    const name = this.names.get(rule.agentKey) ?? parseAgentKey(rule.agentKey)?.id ?? ''
    this.insertAssignment(change.projectId, change.taskId, rule.agentKey, name, 'rule')
    this.deps.emit(change.projectId)
  }

  // ---------- Interno ----------

  private usable(view: AgentView): AgentRuntime {
    if (view.status !== 'ready' || !view.profile) {
      throw new AgentError(view.status, this.statusMessage(view))
    }
    return { key: view.key, profile: view.profile }
  }

  private statusMessage(view: AgentView): string {
    switch (view.status) {
      case 'invalid':
        return AGENT_MESSAGES.invalid
      case 'archived':
        return AGENT_MESSAGES.archived
      case 'needs_review':
        return AGENT_MESSAGES.needsReview
      default:
        return ''
    }
  }

  private insertAssignment(
    projectId: string,
    taskId: string,
    key: AgentKey,
    name: string,
    by: 'manual' | 'rule' | 'orchestrator'
  ): void {
    this.deps.db.run(
      `INSERT INTO agent_assignments (task_page_id, project_id, agent_key, assigned_at, assigned_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (task_page_id) DO UPDATE SET project_id = excluded.project_id,
         agent_key = excluded.agent_key, assigned_at = excluded.assigned_at,
         assigned_by = excluded.assigned_by`,
      taskId,
      projectId,
      key,
      this.now().toISOString(),
      // A tabela só distingue "à mão" de "automático" (o detalhe do evento diz quem).
      by === 'manual' ? 'manual' : 'rule'
    )
    this.taskEvent(projectId, taskId, 'agent_assigned', { agentKey: key, agent: name, by })
  }

  private taskEvent(
    projectId: string,
    taskId: string,
    kind: 'agent_assigned' | 'agent_unassigned',
    detail: Record<string, unknown>
  ): void {
    this.deps.store.addEvent({
      taskPageId: taskId,
      projectId,
      at: this.now().toISOString(),
      kind,
      source: detail['by'] === 'manual' ? 'manual' : 'automation',
      fromStage: null,
      toStage: null,
      detail
    })
  }

  private trust(projectId: string, id: string, hash: string): void {
    this.deps.db.run(
      `INSERT INTO agent_trust (project_id, agent_id, approved_hash, approved_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id, agent_id) DO UPDATE SET approved_hash = excluded.approved_hash,
         approved_at = excluded.approved_at`,
      projectId,
      id,
      hash,
      this.now().toISOString()
    )
  }

  private rules(projectId: string): ProjectAgents['assignOnEnter'] {
    return this.deps.config.get().agents[projectId]?.assignOnEnter ?? []
  }

  private project(projectId: string): { localPath: string } {
    const p = this.deps.config.get().projects.find((x) => x.id === projectId)
    if (!p) throw new AgentError('not_found', AGENT_MESSAGES.projectNotFound)
    return p
  }

  private repoDir(localPath: string): string {
    return join(localPath, '.orkio', 'agents')
  }

  private toView(projectId: string, e: FileEntry, assigned: number): AgentView {
    const key = agentKey(e.scope, e.id)
    const file =
      e.scope === 'repo'
        ? `.orkio/agents/${e.id}.md`
        : e.scope === 'local'
          ? `agents/${e.id}.md (este computador)`
          : 'Embutido no Orkio'
    const hash = e.text === null ? '' : hashOf(e.text)
    const usageToday = this.usage(key)
    const activity = this.activity(key)
    const base = { key, scope: e.scope, id: e.id, file, hash, assigned, usageToday, activity }
    if (e.text === null) {
      return { ...base, status: 'invalid', profile: null, errors: [e.error ?? ''], warnings: [] }
    }
    const parsed = parseAgentFile(e.text)
    if (!parsed.ok) {
      return { ...base, status: 'invalid', profile: null, errors: parsed.errors, warnings: [] }
    }
    if (parsed.profile.id !== e.id) {
      return {
        ...base,
        status: 'invalid',
        profile: null,
        errors: [`O id do arquivo (${parsed.profile.id}) não bate com o nome ${e.id}.md.`],
        warnings: []
      }
    }
    if (
      redactSecrets(parsed.profile.instructions) !== parsed.profile.instructions ||
      redactSecrets(parsed.profile.name) !== parsed.profile.name
    ) {
      return {
        ...base,
        status: 'invalid',
        profile: null,
        errors: [AGENT_MESSAGES.secret],
        warnings: []
      }
    }
    this.names.set(key, parsed.profile.name)
    let status: AgentView['status'] = parsed.profile.archived ? 'archived' : 'ready'
    if (status === 'ready' && e.scope === 'repo') {
      const approved = this.deps.db.get<{ approved_hash: string }>(
        'SELECT approved_hash FROM agent_trust WHERE project_id = ? AND agent_id = ?',
        projectId,
        e.id
      )?.approved_hash
      if (approved !== hash) status = 'needs_review'
    }
    return { ...base, status, profile: parsed.profile, errors: [], warnings: parsed.warnings }
  }

  private async readDir(scope: AgentScope, dir: string): Promise<FileEntry[]> {
    let names: string[]
    try {
      const st = await lstat(dir)
      if (!st.isDirectory()) return []
      names = await readdir(dir)
    } catch {
      return []
    }
    const ids = names
      .map((n) => FILE_NAME.exec(n)?.[1])
      .filter((id): id is string => !!id)
      .sort()
      .slice(0, MAX_FILES)
    const out: FileEntry[] = []
    for (const id of ids) {
      const e = await this.readOne(scope, dir, id)
      if (e) out.push(e)
    }
    return out
  }

  /** Lê `<dir>/<id>.md`: só arquivo comum (sem link), até 16 KB. `null` = não existe. */
  private async readOne(scope: AgentScope, dir: string, id: string): Promise<FileEntry | null> {
    if (!AGENT_ID.test(id)) return null
    const file = join(dir, `${id}.md`)
    try {
      const dirStat = await lstat(dir)
      if (!dirStat.isDirectory()) return null
      const st = await lstat(file)
      if (st.isSymbolicLink() || !st.isFile()) {
        return {
          scope,
          id,
          file,
          text: null,
          error: 'O perfil precisa ser um arquivo comum (sem link).'
        }
      }
      if (st.size > AGENT_LIMITS.fileBytes) {
        return { scope, id, file, text: null, error: 'O arquivo do agente passa de 16 KB.' }
      }
      return { scope, id, file, text: await readFile(file, 'utf8'), error: null }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return { scope, id, file, text: null, error: 'Não foi possível ler o arquivo do agente.' }
    }
  }

  private async writeAtomic(
    scope: AgentScope,
    dir: string,
    projectPath: string,
    id: string,
    text: string
  ): Promise<void> {
    if (scope === 'repo') {
      // Nada de seguir links: .orkio e .orkio/agents precisam ser pastas de verdade no projeto.
      const root = resolve(projectPath)
      const target = resolve(dir)
      if (!target.startsWith(root + sep) || relative(root, target) !== join('.orkio', 'agents')) {
        throw new AgentError('write_failed', AGENT_MESSAGES.writeFailed)
      }
      for (const p of [join(root, '.orkio'), target]) {
        const st = await lstat(p).catch(() => null)
        if (st?.isSymbolicLink()) throw new AgentError('symlink', AGENT_MESSAGES.symlink)
        if (st && !st.isDirectory())
          throw new AgentError('write_failed', AGENT_MESSAGES.writeFailed)
      }
    }
    const file = join(dir, `${id}.md`)
    const st = await lstat(file).catch(() => null)
    if (st?.isSymbolicLink()) throw new AgentError('symlink', AGENT_MESSAGES.symlink)
    const tmp = join(dir, `.${id}.md.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(tmp, text, { encoding: 'utf8', mode: 0o644 })
      await rename(tmp, file)
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined)
      if (error instanceof AgentError) throw error
      throw new AgentError('write_failed', AGENT_MESSAGES.writeFailed)
    }
  }
}

/** Perfil embutido como se fosse um arquivo (mesmo caminho de leitura e validação). */
function builtinEntry(id: string): FileEntry | null {
  const profile = builtinAgent(id)
  if (!profile) return null
  return { scope: 'builtin', id, file: '', text: serializeAgent(profile), error: null }
}

function hashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Tira espaços das pontas e lixo das listas antes de validar/gravar. */
function normalize(p: AgentProfile): AgentProfile {
  return {
    ...p,
    name: typeof p.name === 'string' ? p.name.trim() : p.name,
    commands: Array.isArray(p.commands)
      ? [...new Set(p.commands.map((c) => String(c).trim()))]
      : p.commands,
    instructions:
      typeof p.instructions === 'string'
        ? p.instructions.replace(/\r\n/g, '\n').trim()
        : p.instructions
  }
}
