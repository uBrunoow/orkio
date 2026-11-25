/**
 * Fluxos nativos do Orkio (Fase 1): os três jeitos de rodar uma tarefa ("Como deve rodar?") e a
 * correção dos comentários da PR, montados com as mesmas primitivas dos fluxos da 5A (pedido em
 * texto do Claude Code, gate, ações do Orkio, saltos) e **sem depender do plugin alva-flow**. Nascem
 * prontos: ninguém monta nada. O fluxo é gerado na hora de rodar (com o revisor e a evidência da
 * tarefa) e a cópia vai para `flow_runs.flow_json`, como qualquer fluxo.
 *
 * Puro (main e renderer). Os pedidos ficam exportados: o Claude simulado do E2E os reconhece.
 */
import type { StageRole } from './board'
import { ACTION_VARS, ORKIO_ACTIONS } from './orkio-actions'
import { BRIEFING_PATH, REVIEW_PATH } from './orkio-scratch'
import { FLOW_END, FLOW_YES, type Condition, type Flow, type Step } from './task-flow'
import { RUN_MODE_TEXT, type RunMode } from './task-setup'

export const NATIVE_FLOW_IDS = {
  quick: 'orkio:rapido',
  approval: 'orkio:aprovacao',
  steps: 'orkio:passos',
  prComments: 'orkio:comentarios-pr'
} as const

export function isNativeFlowId(id: string): boolean {
  return (Object.values(NATIVE_FLOW_IDS) as string[]).includes(id)
}

/** Extrator das linhas `@orkio chave=valor` (registrado no main como `ORKIO_LINES_EXTRACTOR`). */
export const LINES_EXTRACTOR = 'linhas_orkio'

/** Variáveis que os pedidos nativos pedem ao Claude no fim da resposta. */
export const NATIVE_VARS = {
  blockers: 'bloqueios',
  slicesLeft: 'restam'
} as const

/** Voltas de correção depois da revisão e fatias no máximo (trava contra laço). */
export const NATIVE_LIMITS = { fixes: 2, slices: 12, revise: 3 } as const

const v = (key: string): string => `{{${key}}}`

const EVIDENCE_LINE =
  'Termine com a seção **Evidência**: os comandos de teste/lint que rodou com o resultado resumido e, para cada critério do briefing, como verificou.'

export const NATIVE_PROMPTS = {
  implement: `Implemente a tarefa descrita em ${BRIEFING_PATH}, de ponta a ponta: código, testes e a suíte verde. Mudanças focadas no que a tarefa pede. Faça commits pequenos com mensagens claras. Não faça push nem abra PR: o Orkio cuida disso depois.`,
  spec: `Escreva a spec da tarefa descrita em ${BRIEFING_PATH}: o problema, o comportamento esperado, critérios de aceite verificáveis e o que fica de fora. Leia o código relacionado antes. Não altere arquivos. Responda só com a spec, em pt-BR.`,
  plan: 'Com a spec aprovada, escreva o plano técnico: os passos em ordem, os arquivos a criar ou mudar e como testar cada parte. Não altere arquivos. Responda só com o plano, em pt-BR.',
  implementApproved:
    'Spec e plano aprovados. Implemente seguindo o plano, com testes e a suíte verde. Faça commits pequenos com mensagens claras. Não faça push nem abra PR: o Orkio cuida disso depois.',
  slicePlan: `Quebre a tarefa descrita em ${BRIEFING_PATH} em fatias pequenas e independentes, cada uma entregável sozinha com teste (de 2 a 8). Para cada fatia: o objetivo, os arquivos e como testar. Não altere arquivos. Responda em pt-BR com as fatias numeradas e, na última linha, @orkio fatias=<quantidade>.`,
  slice: `Implemente a próxima fatia ainda não feita do plano aprovado (uma só), com teste e a suíte verde, e faça o commit dela. Não faça push. Na última linha da resposta, escreva @orkio ${NATIVE_VARS.slicesLeft}=<quantas fatias faltam depois desta>.`,
  review: `Revise o trabalho desta tarefa: o diff da branch contra a base (git diff e git log), comparado ao pedido em ${BRIEFING_PATH}. Procure primeiro o que quebra (bugs, casos de borda, segurança), depois a aderência ao pedido e às convenções. Liste cada achado com arquivo, linha e a correção sugerida, separando os que bloqueiam. Não altere arquivos. Na última linha, escreva @orkio ${NATIVE_VARS.blockers}=<quantos achados bloqueiam>.`,
  fix: 'O revisor apontou problemas que bloqueiam (revisão abaixo). Corrija cada um com testes, rode a suíte e faça o commit. Não faça push.',
  pr: `Abra a pull request desta branch com gh pr create: título curto no padrão do repositório, descrição com o que mudou, como testar e o link da tarefa (${v('notion_url')}). Se a PR já existir, atualize a descrição com gh pr edit. Não faça merge.`,
  prCommentsPlan: `Leia ${REVIEW_PATH} (comentários de revisão não resolvidos da PR #${v(ACTION_VARS.reviewPr)}). Para cada um, diga o que vai mudar e onde, ou por que não vai mudar. Não altere arquivos. Responda só com o plano, em pt-BR, numerado na ordem dos comentários.`,
  prCommentsApply: `Corrija os comentários de revisão não resolvidos da PR (estão em ${REVIEW_PATH}), rode os testes, faça o commit e responda cada thread no GitHub dizendo o que foi feito (resolva as que foram corrigidas).`,
  prCommentsApplyApproved:
    'Plano aprovado. Aplique as correções, rode os testes do projeto, faça o commit e responda cada thread no GitHub dizendo o que foi feito (resolva as que foram corrigidas).'
} as const

function prompt(
  id: string,
  name: string,
  text: string,
  timeoutMin: number,
  extra: Partial<Extract<Step, { type: 'claude_command' }>> = {}
): Step {
  return {
    id,
    name,
    type: 'claude_command',
    command: '',
    args: '',
    prompt: text,
    timeoutMin,
    ...extra
  }
}

function gate(
  id: string,
  name: string,
  message: string,
  show: 'diff' | 'result',
  revise?: string
): Step {
  return {
    id,
    name,
    type: 'gate',
    message,
    show,
    onReject: 'stop',
    timeoutMin: null,
    ...(revise ? { revise: { step: revise, max: NATIVE_LIMITS.revise } } : {})
  }
}

const jump = (id: string, name: string, when: Condition, then: string, elseTo?: string): Step => ({
  id,
  name,
  type: 'branch',
  when,
  then,
  ...(elseTo ? { else: elseTo } : {})
})

const ALWAYS: Condition = { type: 'all', of: [] }

export interface NativeFlowOptions {
  /** Com revisor (outro agente): passo de revisão só leitura e até 2 voltas de correção. */
  review: boolean
  /** Pedir evidência: o pedido de implementação termina com ela e um gate a mostra. */
  evidence: boolean
}

function withEvidence(text: string, evidence: boolean): string {
  return evidence ? `${text}\n\n${EVIDENCE_LINE}` : text
}

/** Evidência (se pedida) → revisão e correções (se há revisor) → diff → push → PR. */
function deliverTail(
  implementStep: string,
  opts: NativeFlowOptions
): { main: Step[]; tail: Step[] } {
  const main: Step[] = []
  if (opts.evidence) {
    main.push(
      gate(
        'conferir-evidencia',
        'Conferir a evidência',
        'Confira a evidência (testes rodados e como cada critério foi verificado). “Pedir ajustes” volta para quem implementa.',
        'result',
        implementStep
      )
    )
  }
  const tail: Step[] = []
  if (opts.review) {
    main.push(
      prompt('revisar', 'Revisão (outro agente, só leitura)', NATIVE_PROMPTS.review, 30, {
        readOnly: true,
        agent: 'reviewer',
        extract: { extractor: LINES_EXTRACTOR }
      }),
      jump(
        'tem-bloqueios',
        `Revisão pediu correções? (até ${NATIVE_LIMITS.fixes} voltas)`,
        {
          type: 'all',
          of: [
            { type: 'var', key: NATIVE_VARS.blockers, op: 'exists' },
            { type: 'var', key: NATIVE_VARS.blockers, op: 'neq', value: '0' },
            { type: 'visits', step: 'corrigir', lt: NATIVE_LIMITS.fixes }
          ]
        },
        'corrigir'
      )
    )
    tail.push(
      prompt('corrigir', 'Corrigir o que a revisão apontou', NATIVE_PROMPTS.fix, 60, {
        withLastResult: true
      }),
      jump(
        'revisar-de-novo',
        'Revisar de novo',
        { type: 'all', of: [{ type: 'visits', step: 'corrigir', lt: NATIVE_LIMITS.fixes + 1 }] },
        'revisar'
      )
    )
  }
  main.push(
    gate(
      'ver-diff',
      'Conferir o diff',
      'Confira o diff antes de enviar. Aprovar envia a branch e abre a PR; recusar encerra sem enviar nada.',
      'diff'
    ),
    {
      id: 'push',
      name: 'Push da branch (Orkio)',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.push.id
    },
    prompt('abrir-pr', 'Abrir a PR (modo entrega)', NATIVE_PROMPTS.pr, 30, { delivery: true })
  )
  if (tail.length > 0) main.push(jump('fim', 'Fim', ALWAYS, FLOW_END))
  return { main, tail }
}

export function nativeQuickFlow(opts: NativeFlowOptions): Flow {
  const { main, tail } = deliverTail('implementar', opts)
  return {
    id: NATIVE_FLOW_IDS.quick,
    name: RUN_MODE_TEXT.quick.label,
    steps: [
      prompt(
        'implementar',
        'Implementar',
        withEvidence(NATIVE_PROMPTS.implement, opts.evidence),
        120
      ),
      ...main,
      ...tail
    ]
  }
}

export function nativeApprovalFlow(opts: NativeFlowOptions): Flow {
  const { main, tail } = deliverTail('implementar', opts)
  return {
    id: NATIVE_FLOW_IDS.approval,
    name: RUN_MODE_TEXT.approval.label,
    steps: [
      prompt('spec', 'Escrever a spec (só leitura)', NATIVE_PROMPTS.spec, 60, { readOnly: true }),
      gate('aprovar-spec', 'Aprovar a spec', 'Aprovar a spec', 'result', 'spec'),
      prompt('plano', 'Escrever o plano (só leitura)', NATIVE_PROMPTS.plan, 60, { readOnly: true }),
      gate('aprovar-plano', 'Aprovar o plano', 'Aprovar o plano', 'result', 'plano'),
      prompt(
        'implementar',
        'Implementar',
        withEvidence(NATIVE_PROMPTS.implementApproved, opts.evidence),
        120
      ),
      ...main,
      ...tail
    ]
  }
}

export function nativeStepsFlow(opts: NativeFlowOptions): Flow {
  const { main, tail } = deliverTail('fatia', opts)
  return {
    id: NATIVE_FLOW_IDS.steps,
    name: RUN_MODE_TEXT.steps.label,
    steps: [
      prompt('plano', 'Quebrar em fatias (só leitura)', NATIVE_PROMPTS.slicePlan, 60, {
        readOnly: true,
        extract: { extractor: LINES_EXTRACTOR }
      }),
      gate('aprovar-plano', 'Aprovar as fatias', 'Aprovar as fatias', 'result', 'plano'),
      prompt(
        'fatia',
        'Implementar a próxima fatia',
        withEvidence(NATIVE_PROMPTS.slice, opts.evidence),
        90,
        {
          extract: { extractor: LINES_EXTRACTOR }
        }
      ),
      jump(
        'proxima-fatia',
        `Ainda faltam fatias? (até ${NATIVE_LIMITS.slices})`,
        {
          type: 'all',
          of: [
            { type: 'var', key: NATIVE_VARS.slicesLeft, op: 'exists' },
            { type: 'var', key: NATIVE_VARS.slicesLeft, op: 'neq', value: '0' },
            { type: 'visits', step: 'fatia', lt: NATIVE_LIMITS.slices }
          ]
        },
        'fatia'
      ),
      ...main,
      ...tail
    ]
  }
}

/**
 * Comentários da PR, nativo (o mesmo caminho do modelo Alva, sem o plugin): lê as threads abertas
 * para `.orkio/revisao.md`; sem nada pendente termina. "Rodar uma vez" corrige direto; os outros
 * modos mostram o plano de correção para você aprovar antes.
 */
export function nativePrCommentsFlow(mode: RunMode): Flow {
  const approve = mode !== 'quick'
  return {
    id: NATIVE_FLOW_IDS.prComments,
    name: 'Corrigir comentários da PR',
    steps: [
      {
        id: 'ler-comentarios',
        name: 'Ler os comentários da PR',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.review_snapshot.id
      },
      jump(
        'sem-comentarios',
        'Nenhum comentário pendente?',
        { type: 'var', key: ACTION_VARS.reviewCount, op: 'eq', value: '0' },
        FLOW_END
      ),
      ...(approve
        ? [
            prompt(
              'plano-correcoes',
              'Plano de correções (só leitura)',
              NATIVE_PROMPTS.prCommentsPlan,
              30,
              {
                readOnly: true
              }
            ),
            gate(
              'aprovar-correcoes',
              'Aprovar correções',
              `Aprovar correções da PR #${v(ACTION_VARS.reviewPr)}`,
              'result',
              'plano-correcoes'
            )
          ]
        : []),
      prompt(
        'aplicar-correcoes',
        'Aplicar correções (modo entrega)',
        approve ? NATIVE_PROMPTS.prCommentsApplyApproved : NATIVE_PROMPTS.prCommentsApply,
        60,
        { delivery: true }
      ),
      {
        id: 'conferir-push',
        name: 'A PR já tem o commit atual?',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.verify_pushed.id
      },
      jump(
        'ja-enviado',
        'Já enviado?',
        { type: 'var', key: ACTION_VARS.prPushed, op: 'eq', value: FLOW_YES },
        'pedir-review'
      ),
      {
        id: 'push',
        name: 'Push da branch (Orkio)',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.push.id
      },
      {
        id: 'pedir-review',
        name: 'Pedir review',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.request_review.id
      }
    ]
  }
}

/**
 * O fluxo nativo de um modo na coluna de papel `role`: na coluna "Revisado" (`reviewed`) é a
 * correção dos comentários da PR; na fila, em revisão e na concluída, nada roda (`null`); nas
 * outras, o fluxo do modo.
 */
export function nativeFlow(
  mode: RunMode,
  opts: NativeFlowOptions,
  role: StageRole | null = null
): Flow | null {
  switch (role) {
    case 'queue':
    case 'review':
    case 'done':
      return null
    case 'reviewed':
      return nativePrCommentsFlow(mode)
    default:
      break
  }
  switch (mode) {
    case 'quick':
      return nativeQuickFlow(opts)
    case 'approval':
      return nativeApprovalFlow(opts)
    case 'steps':
      return nativeStepsFlow(opts)
  }
}
