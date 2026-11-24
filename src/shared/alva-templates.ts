/**
 * Templates "Fluxo Alva" (Etapa 5B): fluxos de tarefa da 5A com os comandos do plugin alva-flow.
 * Gerados sob demanda e editáveis depois. Os comandos recebem só os argumentos (sem o briefing,
 * que fica em .orkio/briefing.md), e o extrator `alva` lê a task do Backlog.md depois de cada um.
 */
import {
  ALVA_EXTRACTOR,
  ALVA_REVIEWED,
  ALVA_TAG,
  ALVA_VARS,
  alvaCommand,
  type AlvaCommand
} from './alva'
import { ACTION_VARS, ORKIO_ACTIONS } from './orkio-actions'
import { REVIEW_PATH } from './orkio-scratch'
import { REVIEW_COMMENTS_MAX } from './review-publish'
import {
  FLOW_END,
  FLOW_YES,
  type Flow,
  type ProjectFlows,
  type StageFlow,
  type Step
} from './task-flow'
import { stageWithRole, type StageRole } from './board'

const v = (key: string): string => `{{${key}}}`
const TASK_ID = v(ALVA_VARS.taskId)

function alva(
  id: string,
  name: string,
  cmd: AlvaCommand,
  args: string,
  timeoutMin: number,
  options: { delivery?: boolean } = {}
): Step {
  return {
    id,
    name,
    type: 'claude_command',
    command: alvaCommand(cmd),
    args,
    timeoutMin,
    includeBriefing: false,
    extract: { extractor: ALVA_EXTRACTOR },
    ...(options.delivery ? { delivery: true } : {})
  }
}

/** Push pelo Orkio (gate com commits/diff/destino quando "Exigir minha aprovação" está ligado). */
const PUSH = (id = 'push'): Step => ({
  id,
  name: 'Push da branch (Orkio)',
  type: 'orkio_action',
  action: ORKIO_ACTIONS.push.id
})

const SPEC = (): Step => alva('spec', 'Especificar (/spec)', 'spec', v(ALVA_VARS.specArg), 120)
const PLAN = (): Step => alva('plan', 'Planejar (/plan)', 'plan', TASK_ID, 60)
const always = { type: 'all' as const, of: [] }

/** Gate com a spec (descrição e critérios de aceite) da task do Backlog, antes de planejar. */
const APPROVE_SPEC = (): Step => ({
  id: 'aprovar-spec',
  name: 'Aprovar spec',
  type: 'gate',
  message:
    'Confira a spec e os critérios de aceite antes de planejar. Recusar encerra o fluxo; ajuste a task e rode de novo.',
  show: 'backlog',
  onReject: 'stop',
  timeoutMin: null
})

/** Gate com o plano técnico da task do Backlog, antes de implementar. */
const APPROVE_PLAN = (): Step => ({
  id: 'aprovar-plano',
  name: 'Aprovar plano',
  type: 'gate',
  message: 'Confira o plano (subtarefas e arquivos) antes de implementar. Recusar encerra o fluxo.',
  show: 'backlog',
  onReject: 'stop',
  timeoutMin: null
})

export const ALVA_TEMPLATE_IDS = {
  plan: 'alva-planejar',
  deliver: 'alva-entregar',
  reviewed: 'alva-revisado',
  review: 'alva-revisao',
  ci: 'alva-ci-vermelho'
} as const

/** Fluxos do app para o botão "Abrir PR" (não ficam na config nem entram em `alvaTemplates`). */
export const OPEN_PR_FLOW_IDS = {
  /** Com task do Backlog.md vinculada: push (Orkio) + /alva-flow:pr em modo entrega. */
  openPr: 'builtin:abrir-pr',
  /** Sem vínculo/plugin: só o push pelo Orkio (a PR se cria no GitHub pelo link de comparação). */
  sendBranch: 'builtin:enviar-branch'
} as const

export function alvaPlanFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.plan,
    name: 'Alva: planejar',
    tags: [ALVA_TAG],
    steps: [
      SPEC(),
      {
        id: 'pequeno',
        name: 'Caminho Pequeno? (spec já implementou)',
        type: 'branch',
        when: { type: 'var', key: ALVA_VARS.status, op: 'eq', value: ALVA_REVIEWED },
        then: FLOW_END
      },
      {
        id: 'sem-perguntas',
        name: 'Sem perguntas em aberto?',
        type: 'branch',
        when: { type: 'var', key: ALVA_VARS.openQuestions, op: 'eq', value: '0' },
        then: 'aprovar-spec'
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
      APPROVE_SPEC(),
      PLAN(),
      APPROVE_PLAN()
    ]
  }
}

export function alvaDeliverFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.deliver,
    name: 'Alva: implementar e entregar',
    tags: [ALVA_TAG],
    steps: [
      {
        id: 'tem-vinculo',
        name: 'Já tem task no Backlog?',
        type: 'branch',
        when: { type: 'var', key: ALVA_VARS.linked, op: 'eq', value: FLOW_YES },
        then: 'ja-revisado'
      },
      SPEC(),
      {
        id: 'pequeno',
        name: 'Caminho Pequeno? (spec já implementou)',
        type: 'branch',
        when: { type: 'var', key: ALVA_VARS.status, op: 'eq', value: ALVA_REVIEWED },
        then: 'ver-diff'
      },
      APPROVE_SPEC(),
      PLAN(),
      APPROVE_PLAN(),
      {
        id: 'ja-revisado',
        name: 'Já revisado (caminho Pequeno)?',
        type: 'branch',
        when: { type: 'var', key: ALVA_VARS.status, op: 'eq', value: ALVA_REVIEWED },
        then: 'ver-diff'
      },
      alva('implement', 'Implementar (/implement)', 'implement', TASK_ID, 120),
      alva('review', 'Revisar (/review)', 'review', TASK_ID, 60),
      {
        id: 'blocker',
        name: 'Blocker no review? (corrige até 2 vezes)',
        type: 'branch',
        when: {
          type: 'all',
          of: [
            { type: 'var', key: ALVA_VARS.reviewBlocker, op: 'eq', value: FLOW_YES },
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
      alva('commit', 'Commit (/commit)', 'commit', TASK_ID, 15),
      PUSH(),
      alva('pr', 'Pull Request (/pr, modo entrega)', 'pr', TASK_ID, 60, {
        delivery: true
      }),
      { id: 'fim', name: 'Fim', type: 'branch', when: always, then: FLOW_END },
      alva('fix', 'Corrigir blocker (/fix --apply)', 'fix', `${TASK_ID} --apply`, 60),
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

/** Pedido do passo de plano (só leitura): o agente lê os comentários e diz o que vai fazer. */
export const REVIEW_PLAN_PROMPT = `Leia ${REVIEW_PATH} (comentários de revisão não resolvidos da PR #${v(ACTION_VARS.reviewPr)}). Para cada um, diga o que vai mudar e onde, ou por que não vai mudar. Não altere arquivos. Responda só com o plano, em pt-BR, numerado na ordem dos comentários.`

/** Pedido do passo de correção (modo entrega), depois que você aprova o plano. */
export const REVIEW_APPLY_PROMPT =
  'Plano aprovado. Aplique as correções, rode os testes do projeto, faça o commit e responda cada thread no GitHub dizendo o que foi feito (resolva as que foram corrigidas).'

export function alvaReviewedFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.reviewed,
    name: 'Alva: comentários da PR',
    tags: [ALVA_TAG],
    steps: [
      {
        id: 'ler-comentarios',
        name: 'Ler os comentários da PR',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.review_snapshot.id
      },
      {
        id: 'sem-comentarios',
        name: 'Nenhum comentário pendente?',
        type: 'branch',
        when: { type: 'var', key: ACTION_VARS.reviewCount, op: 'eq', value: '0' },
        then: FLOW_END
      },
      {
        id: 'plano-correcoes',
        name: 'Plano de correções (só leitura)',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: REVIEW_PLAN_PROMPT,
        readOnly: true,
        timeoutMin: 30
      },
      {
        id: 'aprovar-correcoes',
        name: 'Aprovar correções',
        type: 'gate',
        message: `Aprovar correções da PR #${v(ACTION_VARS.reviewPr)}`,
        show: 'result',
        onReject: 'stop',
        timeoutMin: null,
        revise: { step: 'plano-correcoes', max: 3 }
      },
      {
        id: 'aplicar-correcoes',
        name: 'Aplicar correções (modo entrega)',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: REVIEW_APPLY_PROMPT,
        timeoutMin: 60,
        delivery: true
      },
      {
        id: 'conferir-push',
        name: 'A PR já tem o commit atual?',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.verify_pushed.id
      },
      {
        id: 'ja-enviado',
        name: 'Já enviado?',
        type: 'branch',
        when: { type: 'var', key: ACTION_VARS.prPushed, op: 'eq', value: FLOW_YES },
        then: 'pedir-review'
      },
      PUSH(),
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
 * Pedido do passo que converte a revisão em JSON (só leitura: o agente responde só com o JSON, e
 * o Orkio lê o texto final para o `publish_review`). Sem `{{…}}`: as chaves do JSON não são
 * variáveis.
 */
export const REVIEW_JSON_PROMPT = [
  'Converta a revisão acima no JSON abaixo e responda só com ele, num bloco ```json (sem texto antes ou depois):',
  '{"event": "REQUEST_CHANGES" ou "COMMENT", "summary": "resumo da revisão em markdown", "comments": [{"path": "caminho/do/arquivo", "line": 42, "body": "o problema e a correção sugerida"}]}',
  'Use "REQUEST_CHANGES" se houver qualquer coisa a corrigir (cada item de "comments" é uma correção pedida); "COMMENT" só quando não há nada a corrigir. Nunca aprove.',
  `Em "comments", só achados com arquivo e linha do diff da PR (a linha no arquivo novo), no máximo ${REVIEW_COMMENTS_MAX}; os demais vão no "summary". Escreva em pt-BR. Não altere arquivos.`
].join('\n')

export function alvaReviewPublishFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.review,
    name: 'Alva: revisão publicada',
    tags: [ALVA_TAG],
    steps: [
      alva('review', 'Revisar (/review)', 'review', TASK_ID, 60),
      {
        id: 'revisao-json',
        name: 'Converter a revisão em JSON (só leitura)',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: REVIEW_JSON_PROMPT,
        readOnly: true,
        timeoutMin: 15
      },
      {
        id: 'publicar-revisao',
        name: 'Publicar revisão na PR (orkio[bot])',
        type: 'orkio_action',
        action: ORKIO_ACTIONS.publish_review.id
      }
    ]
  }
}

export function alvaCiFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.ci,
    name: 'Alva: CI vermelho',
    tags: [ALVA_TAG],
    steps: [
      alva('fix-ci', 'Corrigir CI (/fix --ci --apply)', 'fix', `${TASK_ID} --ci --apply`, 60),
      alva('commit', 'Commit (/commit)', 'commit', TASK_ID, 15),
      PUSH()
    ]
  }
}

export function alvaOpenPrFlow(options: { push?: boolean } = {}): Flow {
  return {
    id: OPEN_PR_FLOW_IDS.openPr,
    name: 'Abrir PR',
    tags: [ALVA_TAG],
    steps: [
      // Branch já no GitHub (push anterior ou à mão): vai direto ao /pr.
      ...(options.push === false ? [] : [PUSH()]),
      alva('pr', 'Pull Request (/pr, modo entrega)', 'pr', TASK_ID, 60, {
        delivery: true
      })
    ]
  }
}

/** Botão "Abrir PR" sem task do Backlog.md: só o push pelo Orkio. */
export function sendBranchFlow(): Flow {
  return { id: OPEN_PR_FLOW_IDS.sendBranch, name: 'Enviar branch', steps: [PUSH()] }
}

export function alvaTemplates(): Flow[] {
  return [
    alvaPlanFlow(),
    alvaDeliverFlow(),
    alvaReviewPublishFlow(),
    alvaReviewedFlow(),
    alvaCiFlow()
  ]
}

export type AlvaStagedTemplate = 'plan' | 'deliver' | 'review' | 'reviewed'

/**
 * Coluna de cada modelo Alva pelo papel da etapa (sugestão da tela alva-flow) e se ele já vem
 * ligado sem configurar (`byDefault`): "Alva: revisão publicada" em `review` (Revisando) e
 * "Alva: comentários da PR" em `reviewed` (Revisado), como `defaultRules`.
 */
export const ALVA_TEMPLATE_STAGES: Record<
  AlvaStagedTemplate,
  { role: StageRole; byDefault: boolean }
> = {
  plan: { role: 'plan', byDefault: false },
  deliver: { role: 'work', byDefault: false },
  review: { role: 'review', byDefault: true },
  reviewed: { role: 'reviewed', byDefault: true }
}

/** Ligações padrão (ao entrar), sem configurar. */
export const ALVA_DEFAULT_STAGES: readonly { flowId: string; role: StageRole }[] = (
  Object.keys(ALVA_TEMPLATE_STAGES) as AlvaStagedTemplate[]
)
  .filter((key) => ALVA_TEMPLATE_STAGES[key].byDefault)
  .map((key) => ({ flowId: ALVA_TEMPLATE_IDS[key], role: ALVA_TEMPLATE_STAGES[key].role }))

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function hasAlvaTemplates(pf: Pick<ProjectFlows, 'flows'> | undefined): boolean {
  const ids = new Set<string>(Object.values(ALVA_TEMPLATE_IDS))
  return !!pf?.flows.some((f) => ids.has(f.id))
}

/**
 * Atualiza os modelos Alva de um projeto que já os usa (migração da config e quadro novo):
 * - acrescenta os modelos que faltam;
 * - troca as cópias antigas dos modelos (mesmo id) pela versão nova, se mudaram, guardando antes a
 *   cópia atual como `<id>-anterior` ("<nome> (cópia anterior)", sem coluna), para nada se perder;
 * - liga as etapas de papel `review`/`reviewed` (ao entrar) só se a etapa não tiver fluxo ligado e o modelo ainda não
 *   estiver ligado em outra coluna.
 * Fluxos e ligações criados pelo usuário (outros ids) nunca mudam. Devolve as mudanças em texto
 * (histórico de configuração). Sem modelos Alva no projeto: nada muda.
 */
export function upgradeAlvaFlows(
  pf: ProjectFlows,
  stages: readonly { id: string; name: string; role?: StageRole | undefined }[]
): { flows: ProjectFlows; changes: string[] } {
  if (!hasAlvaTemplates(pf)) return { flows: pf, changes: [] }
  const changes: string[] = []
  const templates = alvaTemplates()
  const byId = new Map(templates.map((t) => [t.id, t]))
  const flows: Flow[] = []
  const backups: Flow[] = []
  const taken = new Set(pf.flows.map((f) => f.id))
  for (const f of pf.flows) {
    const t = byId.get(f.id)
    if (!t || stableJson(t) === stableJson(f)) {
      flows.push(f)
      continue
    }
    // A cópia do projeto difere do modelo novo (pode ter edições suas): guarda como fluxo novo, sem
    // coluna, antes de trocar. "Recriar fluxos Alva" (explícito) não passa por aqui.
    const backup = {
      ...f,
      id: freeId(`${f.id}-anterior`, taken),
      name: `${f.name} (cópia anterior)`
    }
    taken.add(backup.id)
    backups.push(backup)
    changes.push(
      `Cópia anterior de “${f.name}” guardada como “${backup.name}” (sem coluna)`,
      `Fluxo “${t.name}” atualizado para a versão nova do modelo Alva`
    )
    flows.push(t)
  }
  flows.push(...backups)
  for (const t of templates) {
    if (!flows.some((f) => f.id === t.id)) {
      flows.push(t)
      changes.push(`Fluxo “${t.name}” criado (modelo Alva)`)
    }
  }
  const bindings: StageFlow[] = [...pf.bindings]
  for (const d of ALVA_DEFAULT_STAGES) {
    const stageId = stageWithRole(stages, d.role)
    if (!stageId) continue
    if (bindings.some((b) => b.stageId === stageId || b.flowId === d.flowId)) continue
    bindings.push({ stageId, flowId: d.flowId, enabled: true, mode: 'on_enter' })
    const name = byId.get(d.flowId)?.name ?? d.flowId
    const stage = stages.find((s) => s.id === stageId)?.name ?? stageId
    changes.push(`Coluna “${stage}” ganhou o fluxo “${name}” (ao entrar)`)
  }
  return changes.length > 0
    ? { flows: { ...pf, flows, bindings }, changes }
    : { flows: pf, changes }
}
