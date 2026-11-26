import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  ghCalls,
  launchOrkio,
  notionState,
  removeDir,
  setFakes,
  type FakePull,
  type OrkioApp,
  navTo,
  expectTaskHistory,
  taskTab,
  taskScreen,
  FAKE_REPO,
  seedConfig
} from './fixtures'

/**
 * Etapa 5B: integração alva-flow com o Claude Code SIMULADO imitando o plugin (cria e muda
 * backlog/tasks/task-1 - …md), Notion simulado e git real. Nada do plugin real roda aqui.
 */
const NOTION_TOKEN = 'ntn_E2E_ALVA_TOKEN_abcdef123456'
const GITHUB_PAT = 'github_pat_E2E_ALVA_DELIVERY_TOKEN_0123456789'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const PROJECT = 'proj-alva'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const worktree = (): string => join(userDataDir, 'worktrees', PROJECT, 'ORK-2')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const name = new RegExp(`^${esc(label)}( |$)`)
  await scope
    .getByRole('combobox', { name })
    .or(scope.getByRole('button', { name }))
    .first()
    .click()
  await page
    .getByRole('option', { name: new RegExp(`^${esc(option)}( |$)`) })
    .first()
    .click()
}
async function open(
  alva: NonNullable<Parameters<typeof launchOrkio>[2]>['alva']
): Promise<OrkioApp> {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN] },
    { startPage: 'projects', alva: alva ?? {} }
  )
  return orkio
}
async function close(): Promise<void> {
  if (!orkio) return
  await orkio.app.close()
  orkio = null
}
async function goToBoard(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
    .click()
}
const card = (page: Page): Locator => page.getByRole('listitem', { name: ORK2, exact: true })
/** Etapa da tarefa na tela dela (seletor "Mover para" na coluna Detalhes do painel). */
async function expectStage(screen: Locator, stage: string): Promise<void> {
  const panel = screen.page().getByRole('complementary', { name: /^Detalhes de / })
  await panel.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: /^Mover para/ })).toContainText(stage, {
    timeout: 30_000
  })
}
const origin = (): string => join(work, 'origin.git')
const taskBranch = (): string => git(worktree(), 'branch', '--show-current').trim()
const pull = (over: Partial<FakePull> = {}): FakePull => ({
  number: 7,
  title: 'ORK-2 Listar tarefas do Notion',
  head: taskBranch(),
  state: 'open',
  updatedAt: new Date().toISOString(),
  ...over
})
async function moveTo(page: Page, stage: string): Promise<void> {
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: `Mover para ${stage}` }).click()
}
async function flowPanel(page: Page): Promise<Locator> {
  await card(page).click()
  const panel = taskScreen(page, 'ORK-2')
  await expect(panel).toBeVisible()
  return panel
}
const argsLog = (): string[] =>
  readFileSync(join(worktree(), '.orkio', 'alva-args.log'), 'utf8')
    .trim()
    .split('\n')

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(join(repoDir(), 'backlog', 'tasks'), { recursive: true })
  git(work, 'init', '-q', '--bare', '-b', 'main', join(work, 'origin.git'))
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  writeFileSync(join(repoDir(), 'Makefile'), 'test:\n\techo ok\nlint:\n\techo ok\n')
  writeFileSync(join(repoDir(), 'backlog', 'config.yml'), 'project_name: "orkio-app"\n')
  writeFileSync(join(repoDir(), 'backlog', 'tasks', '.gitkeep'), '')
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', join(work, 'origin.git'))
  git(repoDir(), 'push', '-q', 'origin', 'main')
  seedConfig(userDataDir, {
    id: PROJECT,
    name: 'orkio-app',
    localPath: repoDir(),
    repo: FAKE_REPO
  })
})

test.afterAll(async () => {
  await close()
  removeDir(userDataDir)
  removeDir(work)
})

test('critério 1: a pré-checagem mostra o que falta e, completo, fica pronta', async () => {
  const { page } = await open({ plugin: false, mcpBacklog: false, gh: 'missing' })
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')
  // GitHub conectado (sinais/automações e o pedido de review da 5C).
  const gh = await page.evaluate(
    (t) => window.orkio.github.connect({ kind: 'token', token: t }),
    GITHUB_PAT
  )
  expect(gh.state).toBe('connected')
  await goToBoard(page)
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(card(page)).toBeVisible()

  await navTo(page, 'alva-flow')
  const check = page.getByRole('region', { name: 'Pronto para o alva-flow?' })
  await expect(check.getByTestId('alva-ready')).toHaveText('Falta configurar', { timeout: 30_000 })
  const items = check.getByRole('list', { name: 'Itens da pré-checagem' })
  const item = (label: string): Locator => items.getByRole('listitem').filter({ hasText: label })
  await expect(item('Plugin alva-flow')).toContainText('Falta')
  await expect(item('MCP do Backlog.md')).toContainText('claude mcp add backlog --scope user')
  await expect(item('GitHub CLI (gh)')).toContainText('Falta')
  await expect(item('Backlog.md no repositório')).toContainText('OK')
  await expect(item('Makefile')).toContainText('OK')

  // Instalado o que faltava: pronto, com a versão do plugin.
  await close()
  const { page: p2 } = await open({ plugin: true, mcpBacklog: true, gh: 'ok' })
  await goToBoard(p2)
  await navTo(p2, 'alva-flow')
  const check2 = p2.getByRole('region', { name: 'Pronto para o alva-flow?' })
  await expect(check2.getByTestId('alva-ready')).toHaveText('Pronto', { timeout: 30_000 })
  await expect(p2.getByRole('region', { name: 'alva-flow', exact: true })).toContainText('v1.0.25')
})

test('critérios 2 e 3: /spec cria e vincula a task (com o link do Notion); /plan recebe o ID', async () => {
  const { page } = orkio!
  const alva = page.getByRole('region', { name: 'alva-flow', exact: true })
  // Coluna Planejando (status do Notion "Em andamento") e os fluxos Alva nas colunas.
  await choose(page, alva, 'Status do Notion da coluna “Planejando”', 'Em andamento')
  await alva.getByRole('button', { name: 'Criar coluna “Planejando”' }).click()
  await expect(alva.getByText('Coluna “Planejando” criada.')).toBeVisible()
  await alva.getByRole('button', { name: 'Criar fluxos Alva' }).click()
  await expect(alva.getByRole('list', { name: 'Fluxos Alva criados' })).toContainText(
    'Coluna “Planejando”, ao entrar'
  )
  await navTo(page, 'Quadro')

  await moveTo(page, 'Planejando')
  const panel = await flowPanel(page)
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })

  // /spec pergunta em lote: uma por opção, outra por texto livre.
  const q = panel.getByRole('group', { name: 'Pergunta do Claude Code' })
  await expect(q).toContainText('2 perguntas', { timeout: 30_000 })
  await q.getByRole('radio', { name: 'CSV' }).check()
  await q
    .getByRole('group', { name: /^Pergunta 2:/ })
    .getByRole('radio', { name: 'Outro (escrever)' })
    .check()
  await q.getByRole('textbox', { name: 'Sua resposta (pergunta 2)' }).fill('Admins e gestores')
  await q.getByRole('button', { name: 'Enviar respostas' }).click()

  // Spec pronta: para no gate "Aprovar spec", com a task do Backlog na própria tela.
  await expect(flow.getByTestId('flow-status')).toHaveText('Esperando aprovação', {
    timeout: 30_000
  })
  const specGate = flow.getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(specGate).toContainText('Confira a spec')
  const specDoc = specGate.getByRole('region', { name: 'Spec e plano' })
  await expect(specDoc).toContainText('Quem pode exportar? → Admins e gestores')
  await expect(specDoc).toContainText('CA-F01: QUANDO exportar')
  await expect(specDoc).not.toContainText('SECTION:') // os marcadores HTML ficam de fora
  await specGate.getByRole('button', { name: 'Aprovar' }).click()

  // O /plan roda e para no gate "Aprovar plano".
  await expect(flow.getByRole('group', { name: 'Aprovação do fluxo' })).toContainText(
    'Confira o plano',
    { timeout: 30_000 }
  )
  await expect(flow.getByTestId('flow-status')).toHaveText('Esperando aprovação')
  // Fases na barra: spec feita; o plano espera a sua aprovação.
  const phases = page.getByRole('list', { name: 'Fases da tarefa' })
  await expect(phases.getByRole('listitem', { name: 'Spec: feita' })).toBeVisible()
  await expect(phases.getByRole('listitem', { name: 'Plano: esperando você' })).toBeVisible()
  // A spec e o plano aparecem na conversa, logo depois do /spec e do /plan que os escreveram.
  await expect(panel.getByTestId('run-document')).toHaveCount(2)
  await expect(panel.getByTestId('run-document').last()).toContainText('Plano no Backlog.md')
  await expect(panel.getByTestId('run-document').last()).toContainText('CA-F02')
  const details = await taskTab(panel, 'Detalhes')
  await expect(details.getByTestId('alva-task')).toHaveText(
    'Backlog: TASK-1 · Architected · critérios 0/2'
  )
  await taskTab(panel, 'Sessão')
  const taskFile = join(
    worktree(),
    'backlog',
    'tasks',
    readdirSync(join(worktree(), 'backlog', 'tasks')).find((f) => f.startsWith('task-1 - '))!
  )
  const content = readFileSync(taskFile, 'utf8')
  expect(content).toContain('ORK-2 — Listar tarefas do Notion')
  expect(content).toContain('https://www.notion.so/ORK-2-bbbb2') // o /pr não precisa perguntar
  expect(content).toContain('Quem pode exportar? → Admins e gestores')
  expect(argsLog()[0]).toMatch(/^spec ORK-2 — Listar tarefas do Notion\. Tarefa no Notion: /)
  expect(argsLog()[1]).toBe('plan TASK-1') // só o ID: o briefing não vai nos argumentos

  await flow
    .getByRole('group', { name: 'Aprovação do fluxo' })
    .getByRole('button', { name: 'Aprovar' })
    .click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })

  // "Spec e plano" (Detalhes → Documentos) lê a task a qualquer hora (não só nos gates).
  const docs = await taskTab(panel, 'Detalhes')
  await docs.getByRole('button', { name: 'Spec e plano' }).click()
  await expect(docs.getByRole('region', { name: 'Spec e plano' })).toContainText('CA-F02')
  await taskTab(panel, 'Sessão')
  expect(await cspViolations(page)).toEqual([])
})

test('5C critérios 1, 2 e 4: implement → diff → commit → push aprovado → /pr abre a PR → Revisando', async () => {
  const { page, app, logs } = orkio!
  await navTo(page, 'Quadro')
  const mainBefore = git(origin(), 'rev-parse', 'main').trim()
  await moveTo(page, 'Em andamento')
  const panel = await flowPanel(page)
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })

  // Review com blocker → /fix → review limpo → gate do diff.
  const gate = flow.getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toContainText('Confira o diff antes do commit', { timeout: 60_000 })
  await expect(gate.getByRole('region', { name: 'Diff para aprovar' })).toContainText('corrigido')
  expect(argsLog().slice(2)).toEqual([
    'implement TASK-1',
    'review TASK-1',
    'fix TASK-1 --apply',
    'review TASK-1'
  ])
  await gate.getByRole('button', { name: 'Aprovar' }).click()

  // Commit → gate do push com commits, diff e destino. Nada foi enviado ainda.
  const push = flow.getByRole('group', { name: 'Enviar a branch para o GitHub?' })
  await expect(push).toBeVisible({ timeout: 30_000 })
  expect(argsLog().at(-1)).toBe('commit TASK-1')
  await expect(push.getByRole('list', { name: 'Commits que vão para o GitHub' })).toContainText(
    'feat: exportar tarefas'
  )
  await expect(push.getByRole('list', { name: 'Detalhes da ação' })).toContainText(
    `origin → ${taskBranch()}`
  )
  await expect(push.getByTestId('confirm-stat')).toContainText('exportar.ts')
  expect(git(origin(), 'branch', '--list').trim()).toBe('* main')
  // A tarefa aparece em "Esperando você" na lista lateral.
  await expect(
    page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('group', { name: 'Esperando você' })
  ).toContainText('ORK-2')

  // Sobrou um arquivo fora de commit: o push é recusado, o cartão explica e oferece rodar o
  // /commit de novo (que leva o arquivo); depois o fluxo volta ao push.
  writeFileSync(join(worktree(), 'sobra.txt'), 'esqueci de commitar\n')
  await push.getByRole('button', { name: 'Fazer push' }).click()
  const problem = flow.getByRole('group', { name: 'Problema no fluxo' })
  await expect(problem).toContainText('Um passo falhou', { timeout: 30_000 })
  await expect(problem).toContainText('Há mudanças não commitadas')
  await problem.getByRole('button', { name: 'Ver o que falta commitar' }).click()
  await expect(problem.getByRole('group', { name: 'Ainda sem commit' })).toContainText('sobra.txt')
  expect(git(origin(), 'branch', '--list').trim()).toBe('* main') // nada foi enviado
  await problem.getByRole('button', { name: 'Rodar /commit de novo' }).click()
  await expect(push).toBeVisible({ timeout: 30_000 })
  expect(git(worktree(), 'status', '--porcelain', '--', 'sobra.txt').trim()).toBe('')
  await push.getByRole('button', { name: 'Fazer push' }).click()

  // /pr em modo entrega: o primeiro comando do gh pede aprovação (só nesta execução).
  const ask = panel.getByRole('group', { name: 'Pedido de aprovação da entrega' })
  await expect(ask).toContainText('gh pr create --fill --base main', { timeout: 30_000 })
  await expect(ask.getByRole('button', { name: /^Sempre neste projeto/ })).toHaveCount(0)
  // O push foi feito pelo Orkio (sem força), só da branch da tarefa.
  expect(git(origin(), 'rev-parse', taskBranch()).trim()).toBe(
    git(worktree(), 'rev-parse', 'HEAD').trim()
  )
  await ask.getByRole('button', { name: 'Permitir nesta execução' }).click()

  // O /pr espera o CI e pergunta no cartão normal; enquanto isso a PR aparece no GitHub.
  const q = panel.getByRole('group', { name: 'Pergunta do Claude Code' })
  await expect(q).toContainText('O CI ainda está rodando', { timeout: 30_000 })
  expect(ghCalls(userDataDir)).toEqual(['pr create --fill --base main', 'pr checks 7'])
  await setFakes(app, {
    githubPulls: [pull({ sha: git(worktree(), 'rev-parse', 'HEAD').trim() })],
    githubPrDetails: {
      '7': { reviewDecision: 'REVIEW_REQUIRED', unresolved: 0, checks: 'PENDING' }
    }
  })
  // "Atualizar" do quadro = um ciclo das automações agora (a tela da tarefa está aberta).
  await page.evaluate((id) => window.orkio.automation.runNow(id), PROJECT)
  // Critério 2: a PR aberta move a tarefa para Revisando sozinha (3B), sem parar o fluxo.
  await expectStage(panel, 'Revisando')
  await expect(flow.getByTestId('flow-status')).toHaveText('Rodando')
  await expect(flow.getByTestId('pr-ci')).toHaveText('CI rodando (PR #7)')
  await q.getByRole('radio', { name: 'Sim, esperar' }).check()
  await q.getByRole('button', { name: 'Responder' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })

  // Critério 4: merge, força e main continuam impossíveis, mesmo no modo entrega.
  const log = argsLog()
  expect(log).toContain('deny:gh pr merge 7 --squash')
  expect(log).toContain('deny:git push --force origin HEAD:main')
  expect(log).toContain('allow:gh pr create --fill --base main')
  expect(log).toContain('allow:gh pr checks 7') // já aprovado nesta execução
  expect(log.some((l) => l.startsWith('allow:git push'))).toBe(false) // nada novo para o /pr
  expect(ghCalls(userDataDir).some((c) => c.includes('merge'))).toBe(false)
  expect(git(origin(), 'rev-parse', 'main').trim()).toBe(mainBefore)
  // Nenhum token do Orkio no ambiente do Claude Code.
  const env = readFileSync(join(worktree(), '.orkio', 'env.txt'), 'utf8')
  expect(env).not.toContain(GITHUB_PAT)
  expect(env).not.toContain(NOTION_TOKEN)

  // Histórico com cada entrega e o link.
  await expectTaskHistory(
    panel,
    `Push de ${taskBranch()} pelo Orkio`,
    'PR aberta pelo Claude Code (modo entrega)',
    'Claude Code bloqueado'
  )
  expect(await cspViolations(page)).toEqual([])
  expect(logs.join('\n')).not.toContain(GITHUB_PAT)
})

test('5C critério 3 + Task 16: alterações pedidas → Revisado → plano → ajustes → aprovar → correções → push → novo review', async () => {
  const { page, app, logs } = orkio!
  const panel = taskScreen(page, 'ORK-2')
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  const pushedSha = git(origin(), 'rev-parse', taskBranch()).trim()
  const agentArgs = (): Record<string, unknown>[] =>
    readFileSync(join(worktree(), '.orkio', 'agent-args.log'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
  const before = agentArgs().length

  // Ana pede alterações (com uma thread de comentário): a 3B move para Revisado e o fluxo da
  // coluna começa sozinho.
  await setFakes(app, {
    // Task 18: diff da PR (a revisão publicada depois comenta a linha 1 de src/exportar.ts).
    githubPrFiles: {
      '7': [
        {
          filename: 'src/exportar.ts',
          patch:
            '@@ -1 +1 @@\n-export const exportar = true\n+export const exportar = true // corrigido'
        }
      ]
    },
    githubPulls: [pull({ sha: pushedSha })],
    githubPrDetails: {
      '7': {
        reviewDecision: 'CHANGES_REQUESTED',
        unresolved: 1,
        checks: 'FAILURE',
        reviews: [
          {
            id: 'REV-1',
            state: 'CHANGES_REQUESTED',
            submittedAt: new Date().toISOString(),
            author: { login: 'ana' }
          }
        ],
        threads: [
          {
            id: 'thread-7-0',
            isResolved: false,
            path: 'src/exportar.ts',
            line: 1,
            comments: [
              {
                author: 'ana',
                body: 'Valide a entrada antes de exportar.',
                createdAt: new Date().toISOString(),
                url: 'https://github.com/acme/orkio-app/pull/7#discussion_r1'
              }
            ]
          }
        ]
      }
    }
  })
  await page.evaluate((id) => window.orkio.automation.runNow(id), PROJECT)
  await expectStage(panel, 'Revisado')
  await expect(flow).toContainText('Fluxo: Alva: comentários da PR', { timeout: 30_000 })
  // CI vermelho na PR: estado no painel (o botão aparece quando nenhum fluxo está rodando).
  await expect(flow.getByTestId('pr-ci')).toHaveText('CI falhou (PR #7)')

  // O Orkio grava os comentários e o agente propõe um plano, só leitura, antes de mexer no código.
  const gate = flow.getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toContainText('Aprovar correções da PR #7', { timeout: 30_000 })
  const plan = gate.getByRole('region', { name: 'Resultado para aprovar' })
  await expect(plan).toContainText('validar a entrada antes de exportar')
  expect(readFileSync(join(worktree(), '.orkio', 'revisao.md'), 'utf8')).toContain(
    'Valide a entrada antes de exportar.'
  )
  const planRun = agentArgs()[before]!
  expect(planRun['disallowedTools']).toBe('Edit,Write,MultiEdit,NotebookEdit')
  expect(planRun['permissionMode']).toBe('manual')
  expect(planRun['resume']).not.toBeNull() // continua a sessão da tarefa
  expect(git(worktree(), 'rev-parse', 'HEAD').trim()).toBe(pushedSha) // nada mudou ainda
  // "Esperando você" no sino com o título do gate (mensagem com a variável da PR).
  await page.getByRole('button', { name: /esperando você$/ }).click()
  await expect(
    page.getByRole('menuitem').filter({ hasText: 'Aprovar correções da PR #7' })
  ).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')

  // Pedir ajustes: o plano roda de novo na MESMA sessão com o seu texto.
  await gate.getByRole('button', { name: 'Pedir mudanças…' }).click()
  await gate.getByRole('textbox', { name: 'O que mudar' }).fill('Inclua um teste do caso vazio')
  await gate.getByRole('button', { name: 'Enviar' }).click()
  await expect(gate.getByRole('region', { name: 'Resultado para aprovar' })).toContainText(
    'Ajuste pedido: Inclua um teste do caso vazio',
    { timeout: 30_000 }
  )
  const revised = agentArgs().at(-1)!
  expect(revised['resume']).toBe(planRun['resume'])
  expect(revised['disallowedTools']).toBe('Edit,Write,MultiEdit,NotebookEdit')
  expect(revised['permissionMode']).toBe('manual')
  await expect(flow.getByTestId('flow-steps-summary')).toContainText('1 mudanças pedidas')

  // Aprovar: o agente aplica em modo entrega e tenta o push: você recusa (o Orkio oferece o
  // próprio push depois).
  await gate.getByRole('button', { name: 'Aprovar' }).click()
  const ask = panel.getByRole('group', { name: 'Pedido de aprovação da entrega' })
  await expect(ask).toContainText(`git push origin ${taskBranch()}`, { timeout: 30_000 })
  const applyRun = agentArgs().at(-1)!
  expect(applyRun['disallowedTools']).toBeNull()
  expect(applyRun['permissionMode']).toBe('acceptEdits')
  await ask.getByRole('button', { name: 'Negar' }).click()
  // Resolver a conversa: primeiro comando do gh nesta execução → aprovação.
  await expect(ask).toContainText('resolveReviewThread', { timeout: 30_000 })
  await ask.getByRole('button', { name: 'Permitir nesta execução' }).click()

  // A PR não tem o commit novo → push do Orkio, com a confirmação.
  const push = flow.getByRole('group', { name: 'Enviar a branch para o GitHub?' })
  await expect(push).toBeVisible({ timeout: 30_000 })
  await expect(push).toContainText('fix: comentários da revisão')
  await expect(push).toContainText('já existe (só commits novos)')
  expect(git(origin(), 'rev-parse', taskBranch()).trim()).toBe(pushedSha) // nada enviado ainda
  await push.getByRole('button', { name: 'Fazer push' }).click()

  // O agente negou o push e resolveu a conversa (antes do push do Orkio).
  const log = argsLog()
  expect(log.at(-2)).toBe(`deny:git push origin ${taskBranch()}`)
  expect(log.at(-1)).toMatch(/^allow:gh api graphql -f query='mutation \{ resolveReviewThread/)
  // Pede nova revisão a quem revisou (Ana) sem outro gate: você já aprovou o resumo.
  await expect(flow.getByRole('group', { name: 'Pedir review da PR #7?' })).toHaveCount(0)
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })
  expect(git(origin(), 'rev-parse', taskBranch()).trim()).toBe(
    git(worktree(), 'rev-parse', 'HEAD').trim()
  )
  expect((await notionState(app)).reviewRequests).toEqual([
    { pull: 7, reviewers: ['ana'], teams: [] }
  ])
  // O novo pedido de review leva a tarefa de volta para Revisando (3B), sozinho.
  await expectStage(panel, 'Revisando')
  // A sessão mostra as entregas com o link da PR; o histórico completo também.
  const conversation = panel.getByRole('list', { name: 'Conversa da tarefa' })
  await expect(conversation).toContainText('Review pedido na PR #7 pelo Orkio')
  await expect(
    conversation.getByRole('button', { name: 'Abrir a PR #7 no GitHub' }).first()
  ).toBeVisible()
  await expectTaskHistory(
    panel,
    'Mudanças pedidas: Aprovar correções',
    'Conversa de review resolvida',
    'Review pedido na PR #7 pelo Orkio'
  )
  expect(await cspViolations(page)).toEqual([])
  expect(logs.join('\n')).not.toContain(GITHUB_PAT)
})

test('Task 18: Revisando → revisão publicada (padrão da coluna) → gate → orkio[bot] pede alterações → Revisado', async () => {
  const { page, app, logs } = orkio!
  const panel = taskScreen(page, 'ORK-2')
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  const pushedSha = git(origin(), 'rev-parse', taskBranch()).trim()

  // Sem configurar nada: a coluna Revisando já tem o "Alva: revisão publicada" (padrão da tela
  // alva-flow), que começou sozinho com a volta da tarefa para Revisando.
  await expect(flow).toContainText('Fluxo: Alva: revisão publicada', { timeout: 30_000 })
  // Threads resolvidas (para o fluxo do Revisado, que começa depois, terminar sem comentários).
  await setFakes(app, {
    githubPulls: [pull({ sha: pushedSha })],
    githubPrDetails: {
      '7': {
        reviewDecision: 'REVIEW_REQUIRED',
        unresolved: 0,
        checks: 'FAILURE',
        reviews: [
          {
            id: 'REV-1',
            state: 'CHANGES_REQUESTED',
            submittedAt: new Date(Date.now() - 600_000).toISOString(),
            author: { login: 'ana' }
          }
        ],
        threads: []
      }
    }
  })

  // /review → o agente converte em JSON (só leitura) → gate com o que vai para a PR.
  const gate = flow.getByRole('group', { name: 'Publicar a revisão na PR #7?' })
  await expect(gate).toBeVisible({ timeout: 60_000 })
  expect(argsLog().at(-1)).toBe('review TASK-1')
  await expect(gate.getByTestId('review-event')).toHaveText('Pedir alterações')
  // Texto exato que vai para a PR, sem HTML nem imagens (que o GitHub carregaria).
  const summary = gate.getByRole('region', { name: 'Resumo da revisão' })
  await expect(summary).toContainText('Falta **validar a entrada** antes de exportar.')
  await expect(summary).toContainText('[imagem: grafico]')
  await expect(summary).not.toContainText('evil.example')
  await expect(gate.getByRole('list', { name: 'Comentários de linha' })).toContainText(
    'src/exportar.ts:1'
  )
  await expect(gate.getByRole('list', { name: 'Comentários fora do diff' })).toContainText(
    'README.md:40 · fora do diff, não será publicado'
  )
  await expect(gate).toContainText('1 comentário está fora do diff da PR e não será publicado.')
  expect((await notionState(app)).siteReviews ?? []).toEqual([]) // nada antes de aprovar

  await gate.getByRole('button', { name: 'Publicar revisão' }).click()
  // Publicada pelo site do Orkio (que posta como orkio[bot]): só os comentários do diff.
  await expect.poll(async () => (await notionState(app)).siteReviews ?? []).toHaveLength(1)
  const [posted] = (await notionState(app)).siteReviews!
  expect(posted).toMatchObject({
    owner: 'acme',
    repo: 'orkio-app',
    number: 7,
    hasUserToken: true,
    review: {
      event: 'REQUEST_CHANGES',
      comments: [
        { path: 'src/exportar.ts', line: 1, side: 'RIGHT', body: 'Valide a entrada aqui.' }
      ]
    }
  })
  expect(posted!.review.body).toContain('validar a entrada')
  expect(posted!.review.body).toContain('[imagem: grafico]')
  expect(posted!.review.body).not.toContain('evil.example')

  // "Pedir alterações" do orkio[bot] → regra "Alterações pedidas → Revisado" (3B), sozinha.
  await expectStage(panel, 'Revisado')
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })
  await expectTaskHistory(panel, 'Revisão publicada na PR #7 como orkio[bot] (pedir alterações)')

  // Com o fluxo parado e o CI vermelho, o painel oferece o fluxo de CI.
  await expect(flow.getByRole('button', { name: 'Rodar fluxo CI vermelho' })).toBeVisible({
    timeout: 30_000
  })
  expect(await cspViolations(page)).toEqual([])
  expect(logs.join('\n')).not.toContain(GITHUB_PAT)
})

test('Abrir PR: botão na aba PR & CI → gate do push → aprovar → /pr em modo entrega abre a PR', async () => {
  const { page, app } = orkio!
  // Sem PR no GitHub e com um commit novo no ambiente da tarefa (à frente da branch remota).
  await setFakes(app, { githubPulls: [], githubPrDetails: {} })
  writeFileSync(join(worktree(), 'extra.txt'), 'mais uma entrega\n')
  git(worktree(), 'add', 'extra.txt')
  git(worktree(), 'commit', '-q', '-m', 'feat: mais uma entrega')
  await page.evaluate((id) => window.orkio.automation.runNow(id), PROJECT)
  await navTo(page, 'Quadro')
  const before = ghCalls(userDataDir).filter((c) => c.startsWith('pr create')).length

  const panel = await flowPanel(page)
  const prTab = await taskTab(panel, 'PR & CI')
  const button = prTab.getByRole('button', { name: 'Abrir PR' })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  await button.click()

  // O push continua passando pelo gate do Orkio (nada foi enviado ainda).
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  const push = flow.getByRole('group', { name: 'Enviar a branch para o GitHub?' })
  await expect(push).toBeVisible({ timeout: 30_000 })
  await expect(push).toContainText('feat: mais uma entrega')
  await taskTab(panel, 'PR & CI')
  await expect(panel.getByRole('button', { name: 'Abrir PR' })).toBeDisabled()
  await expect(
    panel.getByRole('region', { name: 'PR & CI' }).getByText('Espere o fluxo atual terminar')
  ).toBeVisible()
  await push.getByRole('button', { name: 'Fazer push' }).click()

  // /alva-flow:pr roda em modo entrega: o gh pede a aprovação desta execução e cria a PR.
  const ask = panel.getByRole('group', { name: 'Pedido de aprovação da entrega' })
  await expect(ask).toContainText('gh pr create', { timeout: 30_000 })
  expect(git(origin(), 'rev-parse', taskBranch()).trim()).toBe(
    git(worktree(), 'rev-parse', 'HEAD').trim()
  )
  await ask.getByRole('button', { name: 'Permitir nesta execução' }).click()
  await expect
    .poll(() => ghCalls(userDataDir).filter((c) => c.startsWith('pr create')).length, {
      timeout: 30_000
    })
    .toBe(before + 1)
  expect(argsLog().at(-1)).not.toContain('deny:git push')
  expect(await cspViolations(page)).toEqual([])
})

test('Abrir PR com a branch já enviada: sem o gate do push, vai direto ao /pr', async () => {
  const { page } = orkio!
  const panel = taskScreen(page, 'ORK-2')
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  // Termina o fluxo do teste anterior (parado na pergunta do CI).
  await flow.getByRole('button', { name: 'Cancelar fluxo' }).first().click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Cancelado', { timeout: 30_000 })
  expect(git(origin(), 'rev-parse', taskBranch()).trim()).toBe(
    git(worktree(), 'rev-parse', 'HEAD').trim()
  )
  const before = ghCalls(userDataDir).filter((c) => c.startsWith('pr create')).length

  const prTab = await taskTab(panel, 'PR & CI')
  await prTab.getByRole('button', { name: 'Abrir PR' }).click()
  // Nada novo para enviar: nenhum gate de push; o /pr pede a aprovação do gh.
  const ask = panel.getByRole('group', { name: 'Pedido de aprovação da entrega' })
  await expect(ask).toContainText('gh pr create', { timeout: 30_000 })
  await expect(flow.getByRole('group', { name: 'Enviar a branch para o GitHub?' })).toHaveCount(0)
  await ask.getByRole('button', { name: 'Permitir nesta execução' }).click()
  await expect
    .poll(() => ghCalls(userDataDir).filter((c) => c.startsWith('pr create')).length, {
      timeout: 30_000
    })
    .toBe(before + 1)
  expect(await cspViolations(page)).toEqual([])
})
