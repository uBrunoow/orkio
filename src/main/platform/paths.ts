import { join } from 'node:path'

/**
 * O que o Orkio guarda em `userData` (um lugar só: os serviços e o diagnóstico leem daqui).
 * Formato de cada pasta é do serviço dono:
 * - `worktrees/<projectId>/<ID>`: worktree por tarefa (`WorktreeService`);
 * - `runs/<runId>.jsonl`: log de cada execução do Claude Code (`RunService`);
 * - `run-tmp/`: arquivos temporários das execuções (config do MCP de permissões);
 * - `agents/<id>.md`: perfis de agente "só neste computador" (`AgentsService`);
 * - `agent-memory/<escopo>/…`: memória de cada agente (`AgentMemoryStore`);
 * - `alva-check/`: pasta neutra da pré-checagem do alva-flow.
 */
export interface UserDataPaths {
  secrets: string
  config: string
  db: string
  worktrees: string
  runs: string
  runTmp: string
  agents: string
  agentMemory: string
  alvaCheck: string
}

export function userDataPaths(userData: string, configFile: string): UserDataPaths {
  return {
    secrets: join(userData, 'secrets'),
    config: join(userData, configFile),
    db: join(userData, 'orkio.db'),
    worktrees: join(userData, 'worktrees'),
    runs: join(userData, 'runs'),
    runTmp: join(userData, 'run-tmp'),
    agents: join(userData, 'agents'),
    agentMemory: join(userData, 'agent-memory'),
    alvaCheck: join(userData, 'alva-check')
  }
}
