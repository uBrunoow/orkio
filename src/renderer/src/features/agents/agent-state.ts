/**
 * O que cada agente está fazendo agora (cards da tela Agentes): esperando você, trabalhando ou
 * parado, com as tarefas dele no projeto. Puro: cruza as atribuições com a Visão geral.
 */
import type { AgentBadge, AgentView } from '../../../../shared/agent'
import type { OverviewSnapshot } from '../../../../shared/overview'
import { activityByTask } from '../overview/task-activity'
import type { StatusTone } from '../../components/StatusToken'
import { plural } from '../../lib/format'
import { AGENT_STATUS } from '../../lib/status-text'

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
  const byTask = activityByTask(snapshot, projectId)
  // Na ordem da Visão geral: quem espera há mais tempo, depois o que roda.
  const activity = [...byTask].flatMap(([taskId, a]) => (mine.includes(taskId) ? [a] : []))
  const tasks = mine.map((taskId) => {
    const a = byTask.get(taskId)
    const displayId = (a?.waiting ?? a?.running)?.task.displayId ?? null
    return { taskId, displayId, hot: !!a?.waiting }
  })

  if (agent.status === 'needs_review' || agent.status === 'invalid') {
    const { label, tone } = AGENT_STATUS[agent.status]
    return { filter: 'stopped', tone, text: label, tasks }
  }
  const firstWaiting = activity.find((a) => a.waiting)?.waiting
  if (firstWaiting) {
    const id = firstWaiting.task.displayId ?? 'uma tarefa'
    return {
      filter: 'waiting',
      tone: 'warning',
      text: firstWaiting.kind === 'question' ? `Pergunta em ${id}` : `Esperando você em ${id}`,
      tasks
    }
  }
  const firstRunning = activity.find((a) => a.running)?.running
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
