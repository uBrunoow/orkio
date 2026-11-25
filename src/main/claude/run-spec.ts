/**
 * O que é uma execução do Claude Code, num tipo só. Quem pede (campo da sessão, "Rodar", passo de
 * fluxo) monta um `RunRequest`; o `ClaudeService` o resolve uma vez (sessão, alvo do GitHub,
 * modelo/raciocínio cortados pela versão do CLI) num `RunSpec`, que o `RunService` e o processo
 * (`buildCliArgs` em `runner.ts`) usam sem desmontar. Opção nova = um campo aqui + quem a usa.
 */
import { buildAgentPrompt, type AgentProfile } from '../../shared/agent'
import type { DeliveryTarget } from '../../shared/delivery'
import type { Effort, RuntimeChoice } from '../../shared/agent-runtime'
import type { RunMode } from '../../shared/agent-run'
import type { BranchKind } from '../../shared/slug'
import type { WorktreeProject, WorktreeTask } from './worktree.service'

/** Pedido em texto ou comando instalado (sem a barra) com argumentos. */
export type RunInput =
  { kind: 'prompt'; text: string } | { kind: 'command'; name: string; args: string }

/** Sessão nova (com o briefing, que pode ir ou não no prompt) ou continuação (`--resume`). */
export type RunSession =
  | {
      kind: 'new'
      briefing: string
      /** O briefing vai no prompt (falso = só o comando/texto; o arquivo continua). */
      includeBriefing: boolean
    }
  | { kind: 'resume'; id: string }

/**
 * Ferramentas e GitHub. Só leitura nunca entrega (o tipo não deixa): o passo só de leitura não
 * recebe as ferramentas de edição e a política não libera nada sozinha.
 */
export type RunAccess<Read, Deliver> =
  { tools: 'full'; github: Read | Deliver } | { tools: 'read_only'; github: Read }

export interface RunAgent {
  key: string
  name: string
  /** Texto do `--append-system-prompt` (`buildAgentPrompt`). */
  prompt: string
  /** Alias do modelo; `null` = padrão do usuário. */
  model: string | null
  /** Raciocínio (`--effort`); `null` = padrão. */
  effort: Effort | null
}

/** O agente (perfil lido ou a cópia guardada no fluxo) como vai para a execução. */
export function toRunAgent(agent: { key: string; profile: AgentProfile }): RunAgent {
  return {
    key: agent.key,
    name: agent.profile.name,
    prompt: buildAgentPrompt(agent.profile),
    model: agent.profile.model === 'default' ? null : agent.profile.model,
    effort: agent.profile.effort
  }
}

/** O que quem pede sabe. */
export interface RunRequest {
  projectId: string
  taskId: string
  input: RunInput
  /**
   * `latest`: continua a sessão mais recente da tarefa; sem sessão, começa uma com `orNew` (ou
   * falha com `no_session`, se `null`).
   */
  session:
    | RunSession
    | {
        kind: 'latest'
        orNew: Extract<RunSession, { kind: 'new' }> | null
        /** Ignora as sessões deste agente (ex.: o revisor, que tem sessão própria). */
        excludeAgent?: string
      }
  /**
   * `read`: lê a PR do projeto (se houver repositório verificado); `deliver`: modo entrega (5C),
   * só num passo de fluxo marcado.
   */
  access: RunAccess<'read', 'deliver'>
  /** Agente (8A): instruções no system prompt e modelo. Nenhuma permissão a mais. */
  agent: RunAgent | null
  /** Modelo/raciocínio da mensagem ou do passo (vencem os do agente); `null` = do agente. */
  runtime: Partial<RuntimeChoice> | null
  /** Tempo limite (min): ao estourar, cancela e a execução termina como falha. */
  timeoutMin: number | null
  /** Tipo da branch nova, se ela ainda não existe. */
  branchKind?: BranchKind
}

export type GithubRead = { mode: 'read'; target: DeliveryTarget } | null
export type GithubDeliver = {
  mode: 'deliver'
  target: DeliveryTarget
  requirePushApproval: boolean
}

/** A execução resolvida (o `RunService` só executa). */
export interface RunSpec {
  project: WorktreeProject & { name: string }
  task: WorktreeTask
  input: RunInput
  session: RunSession
  access: RunAccess<GithubRead, GithubDeliver>
  agent: RunAgent | null
  /** Já resolvido (mensagem/passo > agente > padrão) e cortado pela versão do CLI. */
  runtime: RuntimeChoice
  timeoutMin: number | null
}

/** Modo e comando como o histórico guarda (`agent_runs.mode/command/input_text`). */
export function runInputRecord(input: RunInput): {
  mode: RunMode
  command: string | null
  text: string
} {
  return input.kind === 'command'
    ? { mode: 'command', command: input.name, text: input.args }
    : { mode: 'prompt', command: null, text: input.text }
}

export function deliveryOf(spec: Pick<RunSpec, 'access'>): GithubDeliver | null {
  const g = spec.access.github
  return g?.mode === 'deliver' ? g : null
}
