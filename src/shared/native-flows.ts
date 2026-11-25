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
import { PR_WAKE_MAX_CYCLES } from './pr-wake'
import { SLICE_TRAILER, SLICE_VARS } from './slices'
import { BRIEFING_PATH, REVIEW_PATH } from './orkio-scratch'
import { REVIEW_DIFF_PATH, REVIEW_MAX_ROUNDS, REVIEW_VARS } from './review-rounds'
import type { FlowEndTarget } from './flow-final'
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
  slicesLeft: 'restam'
} as const

/**
 * Rodadas de revisão (a 1ª + correções), fatias no máximo (trava contra laço) e "Pedir mudanças"
 * por gate.
 */
export const NATIVE_LIMITS = { reviewRounds: REVIEW_MAX_ROUNDS, slices: 12, revise: 3 } as const

const v = (key: string): string => `{{${key}}}`

const EVIDENCE_LINE =
  'Termine com a seção **Evidência**: os comandos de teste/lint que rodou com o resultado resumido e, para cada critério do briefing, como verificou.'

export const NATIVE_PROMPTS = {
  implement: `Implemente a tarefa descrita em ${BRIEFING_PATH}, de ponta a ponta: código, testes e a suíte verde. Mudanças focadas no que a tarefa pede. Faça commits pequenos com mensagens claras. Não faça push nem abra PR: o Orkio cuida disso depois.`,
  spec: `Escreva a spec da tarefa descrita em ${BRIEFING_PATH}: o problema, o comportamento esperado, critérios de aceite verificáveis e o que fica de fora. Leia o código relacionado antes. Não altere arquivos. Responda só com a spec, em pt-BR.`,
  plan: 'Com a spec aprovada, escreva o plano técnico: os passos em ordem, os arquivos a criar ou mudar e como testar cada parte. Não altere arquivos. Responda só com o plano, em pt-BR.',
  implementApproved:
    'Spec e plano aprovados. Implemente seguindo o plano, com testes e a suíte verde. Faça commits pequenos com mensagens claras. Não faça push nem abra PR: o Orkio cuida disso depois.',
  slicePlan: `Quebre a tarefa descrita em ${BRIEFING_PATH} em fatias pequenas e independentes, cada uma entregável sozinha com teste (de 2 a 8). Para cada fatia: o objetivo, os arquivos, como testar e de quais outras fatias ela depende. Não altere arquivos. Responda em pt-BR com as fatias numeradas; no fim, uma linha @orkio depende_<n>=<fatias separadas por vírgula> para cada fatia que depende de outra e, na última linha, @orkio ${SLICE_VARS.total}=<quantidade>.`,
  slice: `Implemente UMA fatia do plano aprovado, a de número ${v(SLICE_VARS.next)} (se houver mais de um número, escolha uma delas). Fatias já feitas, pelo git: ${v(SLICE_VARS.done)}. Com teste e a suíte verde, entregue a fatia num commit só (junte os seus commits dela num, com squash) cuja mensagem termina com a linha de trailer "${SLICE_TRAILER}: <número da fatia>". O Orkio usa esse trailer para saber o que está pronto: sem ele, a fatia é feita de novo. Não faça push. Na última linha da resposta, escreva @orkio ${NATIVE_VARS.slicesLeft}=<quantas fatias faltam depois desta>.`,
  review: `Revise o trabalho desta tarefa (rodada ${v(REVIEW_VARS.round)} de ${REVIEW_MAX_ROUNDS}). O pedido está em ${BRIEFING_PATH}; o diff da branch contra a base, os commits e os arquivos novos estão em ${REVIEW_DIFF_PATH} (leia esse arquivo em vez de rodar git). Rodada anterior: ${v(REVIEW_VARS.previous)}; se houver, confira se cada bloqueio dela foi corrigido. Leia o código que precisar, só leitura: não altere arquivos nem rode comandos que mudam algo. Procure primeiro o que quebra (bugs, casos de borda, segurança), depois a aderência ao pedido e às convenções do projeto.

Responda em pt-BR exatamente com estas três seções:

## Bloqueios
- [B-1] arquivo:linha — o problema observável e a correção sugerida

## Detalhes
- [D-1] arquivo:linha — o que melhorar (não impede a entrega)

## Evidência
O que você conferiu (arquivos, testes, critérios do pedido) e o que não deu para conferir.

Cada achado tem um ID estável: numa rodada seguinte, o mesmo problema mantém o mesmo ID e problema novo ganha número novo. Seção sem achados: escreva "- Nenhum". Só é bloqueio o que impede entregar (bug, quebra, falta algo pedido); o resto é detalhe.`,
  fix: `O revisor apontou bloqueios na rodada ${v(REVIEW_VARS.round)} (estão em ${v(REVIEW_VARS.file)}). Corrija cada bloqueio, com testes, rode a suíte e faça o commit. Os detalhes são opcionais. Não faça push.`,
  pr: `Abra a pull request desta branch com gh pr create: título curto no padrão do repositório, descrição com o que mudou, como testar e o link da tarefa (${v('notion_url')}). Se a PR já existir, atualize a descrição com gh pr edit. Não faça merge.`,
  prCommentsPlan: `Leia ${REVIEW_PATH} (comentários de revisão não resolvidos da PR #${v(ACTION_VARS.reviewPr)}). Para cada um, diga o que vai mudar e onde, ou por que não vai mudar. Não altere arquivos. Responda só com o plano, em pt-BR, numerado na ordem dos comentários.`,
  ciFix:
    'O CI da PR desta branch falhou. Veja quais checks falharam com gh pr checks e o log com gh run view --log-failed, corrija a causa, rode os testes e faça o commit. Não faça push e não espere o CI no shell (nada de --watch, sleep longo ou tail -f): o Orkio acompanha a PR e chama você de novo se precisar.',
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

const end = (id: string, name: string, key: string, value: string, to: FlowEndTarget): Step =>
  jump(id, name, { type: 'var', key, op: 'eq', value }, to)

/**
 * Evidência (se pedida) → revisão até ficar limpo (se há revisor) → diff → push → PR.
 *
 * Revisão até ficar limpo (Fase 3): o Orkio grava o diff para o revisor (`review_prepare`), o
 * revisor (outro agente, só leitura, sessão nova) responde com Bloqueios/Detalhes/Evidência, o
 * Orkio grava a rodada e decide (`review_record`): limpo segue; travado (mesmos bloqueios) e
 * esgotado (limite de rodadas) encerram o fluxo com esse final; senão quem implementou corrige e
 * o revisor olha de novo.
 */
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
        'Confira a evidência (testes rodados e como cada critério foi verificado). “Pedir mudanças” volta para quem implementa.',
        'result',
        implementStep
      )
    )
  }
  const tail: Step[] = []
  if (opts.review) {
    main.push(
      {
        id: 'preparar-revisao',
        name: 'Preparar a revisão (diff para o revisor)',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.review_prepare.id
      },
      prompt('revisar', 'Revisão (outro agente, só leitura)', NATIVE_PROMPTS.review, 30, {
        readOnly: true,
        agent: 'reviewer'
      }),
      {
        id: 'registrar-revisao',
        name: 'Registrar a rodada de revisão',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.review_record.id
      },
      end(
        'revisao-travada',
        'Os mesmos bloqueios voltaram? (travado)',
        REVIEW_VARS.verdict,
        'travado',
        '$fim:travado'
      ),
      end(
        'revisao-esgotada',
        `Chegou ao limite de ${NATIVE_LIMITS.reviewRounds} rodadas? (esgotado)`,
        REVIEW_VARS.verdict,
        'esgotado',
        '$fim:esgotado'
      ),
      jump(
        'tem-bloqueios',
        'A revisão pediu correções?',
        { type: 'var', key: REVIEW_VARS.verdict, op: 'eq', value: 'corrigir' },
        'corrigir'
      )
    )
    tail.push(
      prompt('corrigir', 'Corrigir os bloqueios da revisão', NATIVE_PROMPTS.fix, 60),
      jump(
        'revisar-de-novo',
        'Revisar de novo',
        {
          type: 'all',
          // Trava de segurança: quem conta as rodadas é o `review_record` (esgotado). Cada
          // "Pedir mudanças" no gate do diff começa outra série, então a trava cobre todas.
          of: [
            {
              type: 'visits',
              step: 'corrigir',
              lt: NATIVE_LIMITS.reviewRounds * (NATIVE_LIMITS.revise + 1)
            }
          ]
        },
        'preparar-revisao',
        '$fim:esgotado'
      )
    )
  }
  main.push(
    gate(
      'ver-diff',
      'Conferir o diff',
      'Confira o diff antes de enviar. Aprovar envia a branch e abre a PR; “Pedir mudanças” volta para quem implementa com o seu comentário; recusar encerra sem enviar nada.',
      'diff',
      implementStep
    ),
    {
      id: 'push',
      name: 'Push da branch (Orkio)',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.push.id
    },
    prompt('abrir-pr', 'Abrir a PR (modo entrega)', NATIVE_PROMPTS.pr, 30, { delivery: true }),
    ...prWaitSteps()
  )
  return { main, tail }
}

/**
 * Fase 5: "a PR acorda o fluxo". Depois de abrir a PR, o fluxo dorme (`wait_pr`) e o Orkio o acorda
 * pelos sinais da PR: mergeada → a tarefa vai para Concluída; fechada → fim sem nada a fazer; CI
 * falhou → corrigir o CI; revisão/comentário novo → corrigir os comentários (respondendo as
 * threads). Depois da correção, push (se faltar) e volta a esperar, até `PR_WAKE_MAX_CYCLES`.
 */
function prWaitSteps(): Step[] {
  const event = (value: string): Condition => ({
    type: 'var',
    key: ACTION_VARS.prEvent,
    op: 'eq',
    value
  })
  return [
    {
      id: 'esperar-pr',
      name: 'Esperar a PR (CI, revisão ou merge)',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.wait_pr.id
    },
    jump('pr-mergeada', 'A PR foi mergeada?', event('merge'), 'concluir-tarefa'),
    jump('pr-fechada', 'A PR foi fechada sem merge? (nada a fazer)', event('fechada'), '$fim:nada'),
    jump('pr-ci-falhou', 'O CI falhou?', event('ci_falhou'), 'corrigir-ci'),
    {
      id: 'ler-comentarios-pr',
      name: 'Ler os comentários da PR',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.review_snapshot.id
    },
    jump(
      'sem-comentarios-pr',
      'Nenhum comentário pendente?',
      { type: 'var', key: ACTION_VARS.reviewCount, op: 'eq', value: '0' },
      'voltar-a-esperar'
    ),
    prompt(
      'corrigir-comentarios',
      'Corrigir os comentários da PR (modo entrega)',
      NATIVE_PROMPTS.prCommentsApply,
      60,
      { delivery: true }
    ),
    jump('conferir-correcoes', 'Conferir o envio das correções', ALWAYS, 'conferir-envio'),
    prompt('corrigir-ci', 'Corrigir o CI da PR', NATIVE_PROMPTS.ciFix, 60),
    {
      id: 'conferir-envio',
      name: 'A PR já tem o commit atual?',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.verify_pushed.id
    },
    jump(
      'ja-enviado-pr',
      'Já enviado?',
      { type: 'var', key: ACTION_VARS.prPushed, op: 'eq', value: FLOW_YES },
      'voltar-a-esperar'
    ),
    {
      id: 'enviar-correcoes',
      name: 'Push das correções (Orkio)',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.push.id
    },
    jump(
      'voltar-a-esperar',
      `Esperar a PR de novo (até ${PR_WAKE_MAX_CYCLES} vezes)`,
      { type: 'all', of: [{ type: 'visits', step: 'esperar-pr', lt: PR_WAKE_MAX_CYCLES }] },
      'esperar-pr',
      '$fim:esgotado'
    ),
    {
      id: 'concluir-tarefa',
      name: 'Mover a tarefa para Concluída',
      type: 'orkio_action',
      action: ORKIO_ACTIONS.move_done.id
    },
    jump('fim', 'Fim', ALWAYS, FLOW_END)
  ]
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
      // Fase 5: o git é o checkpoint: antes de cada fatia, o Orkio lê os trailers da branch.
      {
        id: 'conferir-fatias',
        name: 'Conferir as fatias feitas (git)',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.slices_checkpoint.id
      },
      jump(
        'todas-feitas',
        'Todas as fatias já estão no git?',
        { type: 'var', key: NATIVE_VARS.slicesLeft, op: 'eq', value: '0' },
        main[0]!.id
      ),
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
          of: [{ type: 'visits', step: 'fatia', lt: NATIVE_LIMITS.slices }]
        },
        'conferir-fatias'
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
        'Nenhum comentário pendente? (nada a fazer)',
        { type: 'var', key: ACTION_VARS.reviewCount, op: 'eq', value: '0' },
        '$fim:nada'
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
