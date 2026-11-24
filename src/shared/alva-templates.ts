/**
 * Templates "Fluxo Alva" (Etapa 5B): fluxos de tarefa da 5A com os comandos do plugin alva-flow.
 * Gerados sob demanda e editáveis depois. Os comandos recebem só os argumentos (sem o briefing,
 * que fica em .orkio/briefing.md), e o extrator `alva` lê a task do Backlog.md depois de cada um.
 */
import { FLOW_END, type Flow, type ProjectFlows, type StageFlow, type Step } from './task-flow'

const P = 'alva-flow'

function alva(
  id: string,
  name: string,
  cmd: string,
  args: string,
  timeoutMin: number,
  options: { delivery?: boolean } = {}
): Step {
  return {
    id,
    name,
    type: 'claude_command',
    command: `${P}:${cmd}`,
    args,
    timeoutMin,
    includeBriefing: false,
    extract: { extractor: 'alva' },
    ...(options.delivery ? { delivery: true } : {})
  }
}

/** Push pelo Orkio (gate com commits/diff/destino quando "Exigir minha aprovação" está ligado). */
const PUSH = (id = 'push'): Step => ({
  id,
  name: 'Push da branch (Orkio)',
  type: 'orkio_action',
  action: 'push'
})

const SPEC = (): Step => alva('spec', 'Especificar (/spec)', 'spec', '{{alva.spec_arg}}', 120)
const PLAN = (): Step => alva('plan', 'Planejar (/plan)', 'plan', '{{alva.task_id}}', 60)
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

/**
 * Coluna "Em andamento": (sem vínculo: /spec e /plan) → /implement (pula se já Reviewed) →
 * /review → blocker volta para /fix --apply (máx. 2) → ver diff → /commit → push (Orkio, com
 * aprovação) → /pr em modo entrega (o próprio comando pode fazer push da branch e abrir a PR).
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
      APPROVE_SPEC(),
      PLAN(),
      APPROVE_PLAN(),
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
      PUSH(),
      alva('pr', 'Pull Request (/pr, modo entrega)', 'pr', '{{alva.task_id}}', 60, {
        delivery: true
      }),
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

/** Pedido do passo de plano (só leitura): o agente lê os comentários e diz o que vai fazer. */
export const REVIEW_PLAN_PROMPT =
  'Leia .orkio/revisao.md (comentários de revisão não resolvidos da PR #{{review.pr}}). Para cada um, diga o que vai mudar e onde, ou por que não vai mudar. Não altere arquivos. Responda só com o plano, em pt-BR, numerado na ordem dos comentários.'

/** Pedido do passo de correção (modo entrega), depois que você aprova o plano. */
export const REVIEW_APPLY_PROMPT =
  'Plano aprovado. Aplique as correções, rode os testes do projeto, faça o commit e responda cada thread no GitHub dizendo o que foi feito (resolva as que foram corrigidas).'

/**
 * Coluna "Revisado": o Orkio lê os comentários da PR (`.orkio/revisao.md`) → sem comentários,
 * termina → o agente propõe um plano (só leitura) → você aprova, pede ajustes (até 3) ou recusa →
 * o agente aplica, commita e responde as threads (modo entrega) → confere se a PR tem o commit
 * atual → se não, push pelo Orkio → pedir review de novo.
 */
export function alvaReviewedFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.reviewed,
    name: 'Alva: comentários da PR',
    tags: ['alva'],
    steps: [
      {
        id: 'ler-comentarios',
        name: 'Ler os comentários da PR',
        type: 'orkio_action',
        action: 'review_snapshot'
      },
      {
        id: 'sem-comentarios',
        name: 'Nenhum comentário pendente?',
        type: 'branch',
        when: { type: 'var', key: 'review.count', op: 'eq', value: '0' },
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
        message: 'Aprovar correções da PR #{{review.pr}}',
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
        action: 'verify_pushed'
      },
      {
        id: 'ja-enviado',
        name: 'Já enviado?',
        type: 'branch',
        when: { type: 'var', key: 'pr.pushed', op: 'eq', value: 'sim' },
        then: 'pedir-review'
      },
      PUSH(),
      { id: 'pedir-review', name: 'Pedir review', type: 'orkio_action', action: 'request_review' }
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
  'Em "comments", só achados com arquivo e linha do diff da PR (a linha no arquivo novo), no máximo 50; os demais vão no "summary". Escreva em pt-BR. Não altere arquivos.'
].join('\n')

/**
 * Coluna "Revisando": /review → o agente converte a revisão em JSON (só leitura) → o Orkio mostra
 * o tipo, o resumo e os comentários e, aprovado, publica na PR como `orkio[bot]` (site do Orkio).
 * "Pedir alterações" dispara a regra "Alterações pedidas → Revisado".
 */
export function alvaReviewPublishFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.review,
    name: 'Alva: revisão publicada',
    tags: ['alva'],
    steps: [
      alva('review', 'Revisar (/review)', 'review', '{{alva.task_id}}', 60),
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
        action: 'publish_review'
      }
    ]
  }
}

/** Avulso (manual, botão "Rodar fluxo CI vermelho"): /fix --ci --apply → /commit → push. */
export function alvaCiFlow(): Flow {
  return {
    id: ALVA_TEMPLATE_IDS.ci,
    name: 'Alva: CI vermelho',
    tags: ['alva'],
    steps: [
      alva('fix-ci', 'Corrigir CI (/fix --ci --apply)', 'fix', '{{alva.task_id}} --ci --apply', 60),
      alva('commit', 'Commit (/commit)', 'commit', '{{alva.task_id}}', 15),
      PUSH()
    ]
  }
}

/** Botão "Abrir PR": push da branch da tarefa (com o gate) e `/alva-flow:pr` em modo entrega. */
export function alvaOpenPrFlow(options: { push?: boolean } = {}): Flow {
  return {
    id: OPEN_PR_FLOW_IDS.openPr,
    name: 'Abrir PR',
    tags: ['alva'],
    steps: [
      // Branch já no GitHub (push anterior ou à mão): vai direto ao /pr.
      ...(options.push === false ? [] : [PUSH()]),
      alva('pr', 'Pull Request (/pr, modo entrega)', 'pr', '{{alva.task_id}}', 60, {
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

/**
 * Ligações padrão (ao entrar), sem configurar: "Alva: revisão publicada" em "Revisando" e "Alva:
 * comentários da PR" em "Revisado". Etapas pelo nome, sem acento/caixa (como `defaultRules`).
 */
export const ALVA_DEFAULT_STAGES: readonly { flowId: string; stage: string }[] = [
  { flowId: ALVA_TEMPLATE_IDS.review, stage: 'Revisando' },
  { flowId: ALVA_TEMPLATE_IDS.reviewed, stage: 'Revisado' }
]

const normName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/** Etapa com o nome (sem acento/caixa) ou `null`. */
export function stageByName(
  stages: readonly { id: string; name: string }[],
  name: string
): string | null {
  return stages.find((s) => normName(s.name) === normName(name))?.id ?? null
}

/** JSON com as chaves em ordem (comparação que não depende da ordem das chaves). */
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

/** `base`, senão `base-2`, `base-3`… (ids de fluxo livres no projeto). */
function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** O projeto já usa os modelos do alva-flow (algum fluxo com id de modelo Alva)? */
export function hasAlvaTemplates(pf: Pick<ProjectFlows, 'flows'> | undefined): boolean {
  const ids = new Set<string>(Object.values(ALVA_TEMPLATE_IDS))
  return !!pf?.flows.some((f) => ids.has(f.id))
}

/**
 * Atualiza os modelos Alva de um projeto que já os usa (migração da config e quadro novo):
 * - acrescenta os modelos que faltam;
 * - troca as cópias antigas dos modelos (mesmo id) pela versão nova, se mudaram, guardando antes a
 *   cópia atual como `<id>-anterior` ("<nome> (cópia anterior)", sem coluna), para nada se perder;
 * - liga Revisando/Revisado (ao entrar) só se a etapa não tiver fluxo ligado e o modelo ainda não
 *   estiver ligado em outra coluna.
 * Fluxos e ligações criados pelo usuário (outros ids) nunca mudam. Devolve as mudanças em texto
 * (histórico de configuração). Sem modelos Alva no projeto: nada muda.
 */
export function upgradeAlvaFlows(
  pf: ProjectFlows,
  stages: readonly { id: string; name: string }[]
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
    const stageId = stageByName(stages, d.stage)
    if (!stageId) continue
    if (bindings.some((b) => b.stageId === stageId || b.flowId === d.flowId)) continue
    bindings.push({ stageId, flowId: d.flowId, enabled: true, mode: 'on_enter' })
    const name = byId.get(d.flowId)?.name ?? d.flowId
    const stage = stages.find((s) => s.id === stageId)?.name ?? d.stage
    changes.push(`Coluna “${stage}” ganhou o fluxo “${name}” (ao entrar)`)
  }
  return changes.length > 0
    ? { flows: { ...pf, flows, bindings }, changes }
    : { flows: pf, changes }
}
