/**
 * Templates "Fluxo Alva" (Etapa 5B): fluxos de tarefa da 5A com os comandos do plugin alva-flow.
 * Gerados sob demanda e editáveis depois. Os comandos recebem só os argumentos (sem o briefing,
 * que fica em .orkio/briefing.md), e o extrator `alva` lê a task do Backlog.md depois de cada um.
 */
import { FLOW_END, type Flow, type Step } from './task-flow'

const P = 'alva-flow'

function alva(id: string, name: string, cmd: string, args: string, timeoutMin: number): Step {
  return {
    id,
    name,
    type: 'claude_command',
    command: `${P}:${cmd}`,
    args,
    timeoutMin,
    includeBriefing: false,
    extract: { extractor: 'alva' }
  }
}

const SPEC = (): Step => alva('spec', 'Especificar (/spec)', 'spec', '{{alva.spec_arg}}', 120)
const PLAN = (): Step => alva('plan', 'Planejar (/plan)', 'plan', '{{alva.task_id}}', 60)
const always = { type: 'all' as const, of: [] }

export const ALVA_TEMPLATE_IDS = {
  plan: 'alva-planejar',
  deliver: 'alva-entregar',
  reviewed: 'alva-revisado',
  ci: 'alva-ci-vermelho'
} as const

/** Coluna "Planejando": /spec → (Pequeno termina) → perguntas em aberto → /plan → aprovar plano. */
export function alvaPlanFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.plan,
    name: 'Alva: planejar',
    tags: ['alva'],
    steps: [
      SPEC(),
      {
        id: 'pequeno',
        name: 'Caminho Pequeno? (spec já implementou)',
        type: 'branch',
        when: { type: 'var', key: 'alva.status', op: 'eq', value: 'Reviewed' },
        then: FLOW_END
      },
      {
        id: 'sem-perguntas',
        name: 'Sem perguntas em aberto?',
        type: 'branch',
        when: { type: 'var', key: 'alva.open_questions', op: 'eq', value: '0' },
        then: 'plan'
      },
      {
        id: 'perguntas',
        name: 'Perguntas em aberto',
        type: 'gate',
        message:
          'A spec ainda tem perguntas em aberto e o /plan não avança assim. Aprovar roda o /spec de novo para responder; recusar encerra.',
        show: 'none',
        onReject: 'stop',
        timeoutMin: null
      },
      {
        id: 'responder',
        name: 'Responder no /spec (até 3 vezes)',
        type: 'branch',
        when: { type: 'all', of: [{ type: 'visits', step: 'spec', lt: 3 }] },
        then: 'spec',
        else: FLOW_END
      },
      PLAN(),
      {
        id: 'aprovar-plano',
        name: 'Aprovar plano',
        type: 'gate',
        message: 'Confira o plano na task do Backlog.md antes de implementar.',
        show: 'summary',
        onReject: 'stop',
        timeoutMin: null
      }
    ]
  }
}

/**
 * Coluna "Em andamento": (sem vínculo: /spec e /plan) → /implement (pula se já Reviewed) →
 * /review → blocker volta para /fix --apply (máx. 2) → ver diff → /commit → push (5C) → /pr.
 */
export function alvaDeliverFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.deliver,
    name: 'Alva: implementar e entregar',
    tags: ['alva'],
    steps: [
      {
        id: 'tem-vinculo',
        name: 'Já tem task no Backlog?',
        type: 'branch',
        when: { type: 'var', key: 'alva.linked', op: 'eq', value: 'sim' },
        then: 'ja-revisado'
      },
      SPEC(),
      {
        id: 'pequeno',
        name: 'Caminho Pequeno? (spec já implementou)',
        type: 'branch',
        when: { type: 'var', key: 'alva.status', op: 'eq', value: 'Reviewed' },
        then: 'ver-diff'
      },
      PLAN(),
      {
        id: 'ja-revisado',
        name: 'Já revisado (caminho Pequeno)?',
        type: 'branch',
        when: { type: 'var', key: 'alva.status', op: 'eq', value: 'Reviewed' },
        then: 'ver-diff'
      },
      alva('implement', 'Implementar (/implement)', 'implement', '{{alva.task_id}}', 120),
      alva('review', 'Revisar (/review)', 'review', '{{alva.task_id}}', 60),
      {
        id: 'blocker',
        name: 'Blocker no review? (corrige até 2 vezes)',
        type: 'branch',
        when: {
          type: 'all',
          of: [
            { type: 'var', key: 'alva.review_blocker', op: 'eq', value: 'sim' },
            { type: 'visits', step: 'fix', lt: 2 }
          ]
        },
        then: 'fix'
      },
      {
        id: 'ver-diff',
        name: 'Ver diff antes do commit',
        type: 'gate',
        message:
          'Confira o diff antes do commit. Se o review ainda aponta blocker, recuse e corrija à mão.',
        show: 'diff',
        onReject: 'stop',
        timeoutMin: null
      },
      alva('commit', 'Commit (/commit)', 'commit', '{{alva.task_id}}', 15),
      { id: 'push', name: 'Push da branch', type: 'orkio_action', action: 'push' },
      alva('pr', 'Pull Request (/pr)', 'pr', '{{alva.task_id}}', 60),
      { id: 'fim', name: 'Fim', type: 'branch', when: always, then: FLOW_END },
      alva('fix', 'Corrigir blocker (/fix --apply)', 'fix', '{{alva.task_id}} --apply', 60),
      {
        id: 'revisar-de-novo',
        name: 'Revisar de novo',
        type: 'branch',
        when: { type: 'all', of: [{ type: 'visits', step: 'fix', lt: 3 }] },
        then: 'review'
      }
    ]
  }
}

/** Coluna "Revisado": tratar comentários da PR → pedir review (5C). */
export function alvaReviewedFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.reviewed,
    name: 'Alva: comentários da PR',
    tags: ['alva'],
    steps: [
      alva(
        'comentarios',
        'Tratar comentários (/pr --comments)',
        'pr',
        '{{alva.task_id}} --comments',
        60
      ),
      { id: 'pedir-review', name: 'Pedir review', type: 'orkio_action', action: 'request_review' }
    ]
  }
}

/** Avulso (manual): CI vermelho → /fix --ci --apply → /commit → push (5C). */
export function alvaCiFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.ci,
    name: 'Alva: CI vermelho',
    tags: ['alva'],
    steps: [
      alva('fix-ci', 'Corrigir CI (/fix --ci --apply)', 'fix', '{{alva.task_id}} --ci --apply', 60),
      alva('commit', 'Commit (/commit)', 'commit', '{{alva.task_id}}', 15),
      { id: 'push', name: 'Push da branch', type: 'orkio_action', action: 'push' }
    ]
  }
}

export function alvaTemplates(): Flow[] {
  return [alvaPlanFlow(), alvaDeliverFlow(), alvaReviewedFlow(), alvaCiFlow()]
}
