/**
 * Textos de um passo de fluxo por tipo, num lugar só: o nome curto (frase-título do fluxo), a linha
 * do editor, a frase da lista "Faz" e o que o plano mostra ("Sua aprovação", "Ação do Orkio: …").
 */
import { orkioAction } from '../../../../shared/orkio-actions'
import { isPromptStep, type GateShow, type Step } from '../../../../shared/task-flow'

/** O que o gate mostra ao aprovar: opção do editor, trecho da linha e trecho da frase. */
export const GATE_SHOW_TEXT: Record<
  GateShow,
  { option: string; summary: string | null; sentence: string }
> = {
  diff: {
    option: 'Diff da pasta de trabalho',
    summary: 'mostra o diff',
    sentence: ' mostrando o diff'
  },
  summary: {
    option: 'Resumo da última execução',
    summary: 'mostra o resumo',
    sentence: ' com o resumo'
  },
  backlog: {
    option: 'Spec e plano (task do Backlog)',
    summary: 'mostra a spec e o plano',
    sentence: ' com a spec e o plano'
  },
  result: {
    option: 'Resultado do Claude Code (texto final)',
    summary: 'mostra o resultado',
    sentence: ' com o resultado do Claude Code'
  },
  none: { option: 'Nada', summary: null, sentence: '' }
}

/** Rótulo da ação do Orkio (o id quando a ação não existe mais). */
export function actionLabel(id: string): string {
  return orkioAction(id)?.label ?? id
}

/** Nome curto do passo para a frase-título ("/revisar", "aprovação"…). */
export function stepShort(step: Step): string {
  switch (step.type) {
    case 'claude_command':
      return isPromptStep(step) ? `pedido “${step.name}”` : `/${step.command || '…'}`
    case 'gate':
      return 'aprovação'
    case 'orkio_action':
      return actionLabel(step.action)
    case 'branch':
      return 'salto'
  }
}

/** Uma linha que resume o passo (lista de passos do editor). */
export function stepSummary(step: Step): string {
  switch (step.type) {
    case 'claude_command':
      return [
        step.prompt !== undefined
          ? `pedido: “${step.prompt.trim() || '…'}”`
          : `/${step.command || '…'} ${step.args}`.trim(),
        `${step.timeoutMin} min`,
        ...(step.readOnly ? ['só leitura'] : []),
        ...(step.delivery ? ['modo entrega'] : [])
      ].join(' · ')
    case 'gate':
      return [
        `“${step.message}”`,
        GATE_SHOW_TEXT[step.show].summary,
        `recusar → ${step.onReject === 'stop' ? 'encerra' : step.onReject}`,
        step.revise ? `ajustes → ${step.revise.step} (até ${step.revise.max})` : null
      ]
        .filter(Boolean)
        .join(' · ')
    case 'orkio_action':
      return actionLabel(step.action)
    case 'branch':
      return `ir para ${step.then}${step.else ? ` · senão ${step.else}` : ' · senão segue'}`
  }
}

/** Uma frase por passo ("Faz"). */
export function stepSentence(step: Step, stepName: (id: string) => string): string {
  switch (step.type) {
    case 'claude_command': {
      const mode = [
        step.readOnly ? 'só leitura' : '',
        step.delivery ? 'em modo entrega' : ''
      ].filter(Boolean)
      const extra = `(até ${step.timeoutMin} min)${mode.length ? `, ${mode.join(', ')}` : ''}`
      return isPromptStep(step)
        ? `Pede ao Claude Code, na conversa da tarefa: “${step.prompt!.trim()}” ${extra}.`
        : `Roda /${step.command || '…'}${step.args ? ` ${step.args}` : ''} no Claude Code ${extra}.`
    }
    case 'gate': {
      const reject =
        step.onReject === 'stop'
          ? 'recusar encerra'
          : `recusar volta para ${stepName(step.onReject)}`
      const revise = step.revise
        ? `; pedir ajustes volta para ${stepName(step.revise.step)}, até ${step.revise.max} vezes`
        : ''
      return `Pede sua aprovação${GATE_SHOW_TEXT[step.show].sentence}: “${step.message}” (${reject}${revise}).`
    }
    case 'orkio_action':
      return `${actionLabel(step.action)}.`
    case 'branch':
      return `Se a condição bater, vai para ${stepName(step.then)}; senão ${step.else ? `vai para ${stepName(step.else)}` : 'segue'}.`
  }
}

/** O que o passo faz, curto, no plano do fluxo (`/alva-flow:spec`, "Sua aprovação", a ação). */
export function stepDetail(step: Exclude<Step, { type: 'branch' }>): string {
  switch (step.type) {
    case 'claude_command':
      if (isPromptStep(step)) {
        return step.readOnly ? 'Pedido ao Claude Code (só leitura)' : 'Pedido ao Claude Code'
      }
      return `/${step.command}`
    case 'gate':
      return 'Sua aprovação'
    case 'orkio_action':
      return `Ação do Orkio: ${actionLabel(step.action)}`
  }
}
