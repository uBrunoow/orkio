/**
 * "O que este fluxo faz", em uma ou duas frases para gente (aba Fluxos). Os modelos conhecidos
 * (alva-flow) têm o texto escrito à mão; os seus fluxos ganham um resumo pelos passos. Puro.
 */
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import type { Flow } from '../../../../shared/task-flow'
import { plural } from '../../lib/format'

const KNOWN: Record<string, string> = {
  [ALVA_TEMPLATE_IDS.plan]:
    'Escreve a spec da tarefa com o /spec, responde as perguntas em aberto e monta o plano com o /plan. Você aprova a spec e o plano antes de seguir.',
  [ALVA_TEMPLATE_IDS.deliver]:
    'Implementa, revisa e corrige até ficar limpo, mostra o diff para você aprovar, faz o commit, envia a branch e abre a PR.',
  [ALVA_TEMPLATE_IDS.reviewed]:
    'Lê os comentários da PR, propõe um plano de correção para você aprovar, aplica as correções, envia e pede uma nova revisão.',
  [ALVA_TEMPLATE_IDS.review]:
    'Revisa a PR com o /review e publica a revisão no GitHub como orkio[bot], depois da sua aprovação.',
  [ALVA_TEMPLATE_IDS.ci]: 'Quando o CI da PR falha, investiga o erro, corrige e envia de novo.'
}

/** Ações do Orkio que valem uma menção no resumo. */
const ACTION_TEXT: Record<string, string> = {
  push: 'envia a branch',
  request_review: 'pede revisão',
  rerequest_review: 'pede nova revisão',
  publish_review: 'publica a revisão',
  review_snapshot: 'lê os comentários da PR',
  verify_pushed: 'confere o envio'
}

export function flowPurpose(flow: Flow): string {
  const known = KNOWN[flow.id]
  if (known) return known
  if (flow.steps.length === 0) return 'Ainda sem passos. Edite para dizer o que ele faz.'
  const commands = [
    ...new Set(
      flow.steps.flatMap((s) =>
        s.type === 'claude_command'
          ? [s.command ? `/${s.command}` : 'um pedido ao Claude Code']
          : []
      )
    )
  ]
  const gates = flow.steps.filter((s) => s.type === 'gate').length
  const actions = [
    ...new Set(
      flow.steps.flatMap((s) =>
        s.type === 'orkio_action' && ACTION_TEXT[s.action] ? [ACTION_TEXT[s.action]!] : []
      )
    )
  ]
  const parts: string[] = []
  if (commands.length > 0) parts.push(`Roda ${listText(commands)}`)
  if (gates > 0) parts.push(`pede sua aprovação ${gates === 1 ? 'uma vez' : `${gates} vezes`}`)
  if (actions.length > 0) parts.push(listText(actions))
  const body = parts.length > 0 ? listText(parts) : plural(flow.steps.length, 'passo', 'passos')
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`
}
