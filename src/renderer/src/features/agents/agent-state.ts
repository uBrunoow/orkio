/**
 * O que cada agente está fazendo agora (cards da tela Agentes): esperando você, trabalhando ou
 * parado, com as tarefas dele no projeto. Puro: cruza as atribuições com a Visão geral.
 */
import type { AgentBadge, AgentView } from '../../../../shared/agent'
import type { OverviewSnapshot } from '../../../../shared/overview'
import type { StatusTone } from '../../components/StatusToken'
import { plural } from '../../lib/format'

export type AgentFilter = 'all' | 'waiting' | 'working' | 'stopped'

export interface AgentNow {
  filter: Exclude<AgentFilter, 'all'>
  tone: StatusTone
  text: string
  tasks: { taskId: string; displayId: string | null; hot: boolean }[]
}

export function agentNow(input: {
  agent: AgentView
  badges: Record<string, AgentBadge>
  snapshot: OverviewSnapshot | null
  projectId: string
}): AgentNow {
  const { agent, snapshot, projectId } = input
  const mine = Object.entries(input.badges)
    .filter(([, b]) => b.key === agent.key)
    .map(([taskId]) => taskId)
  const waitingItems = (snapshot?.waiting ?? []).filter(
    (w) => w.task.projectId === projectId && mine.includes(w.task.taskId)
  )
  const runningItems = (snapshot?.running ?? []).filter(
    (r) => r.task.projectId === projectId && mine.includes(r.task.taskId)
  )
  const idOf = (taskId: string): string | null =>
    [...(snapshot?.waiting ?? []), ...(snapshot?.running ?? [])].find(
      (i) => i.task.taskId === taskId
    )?.task.displayId ?? null
  const hot = new Set(waitingItems.map((w) => w.task.taskId))
  const tasks = mine.map((taskId) => ({ taskId, displayId: idOf(taskId), hot: hot.has(taskId) }))

  if (agent.status === 'needs_review' || agent.status === 'invalid') {
    return {
      filter: 'stopped',
      tone: 'warning',
      text: agent.status === 'needs_review' ? 'Precisa de revisão' : 'Perfil inválido',
      tasks
    }
  }
  const firstWaiting = waitingItems[0]
  if (firstWaiting) {
    const id = firstWaiting.task.displayId ?? 'uma tarefa'
    return {
      filter: 'waiting',
      tone: 'warning',
      text: firstWaiting.kind === 'question' ? `Pergunta em ${id}` : `Esperando você em ${id}`,
      tasks
    }
  }
  const firstRunning = runningItems[0]
  if (firstRunning) {
    return {
      filter: 'working',
      tone: 'running',
      text: `Trabalhando em ${firstRunning.task.displayId ?? 'uma tarefa'}`,
      tasks
    }
  }
  return {
    filter: 'stopped',
    tone: 'neutral',
    text:
      agent.assigned > 0
        ? `Livre · ${plural(agent.assigned, 'tarefa atribuída', 'tarefas atribuídas')}`
        : 'Livre',
    tasks
  }
}
