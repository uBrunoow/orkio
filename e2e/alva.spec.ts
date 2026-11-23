import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
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
  taskTab
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
const column = (page: Page, name: string): Locator =>
  page.getByRole('list', { name: 'Etapas do quadro' }).getByRole('listitem', { name, exact: true })
async function expectIn(page: Page, stage: string): Promise<void> {
  await expect(column(page, stage).getByRole('listitem', { name: ORK2, exact: true })).toBeVisible({
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
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
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
  writeFileSync(
    join(userDataDir, 'orkio-config.json'),
    JSON.stringify({
      schemaVersion: 2,
      notion: {
        projectsDataSource: { id: NOTION_FAKE.projectsDs, name: 'Projetos' },
        tasksDataSource: { id: NOTION_FAKE.tasksDs, name: 'Tarefas' },
        mapping: {
          title: { id: 'title', name: 'Nome', type: 'title' },
          status: { id: 'st%3A', name: 'Status', type: 'status' },
          uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
          project: { id: 'rel', name: 'Projeto', type: 'relation' },
          priority: { id: 'pri', name: 'Prioridade', type: 'select' },
          assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
        },
        updatedAt: '2026-11-19T00:00:00.000Z'
      },
      projects: [
        {
          id: PROJECT,
          name: 'orkio-app',
          localPath: repoDir(),
          repo: {
            host: 'github.com',
            owner: 'acme',
            name: 'orkio-app',
            remoteName: 'origin',
            defaultBranch: 'main',
            visibility: 'private',
            canPush: true,
            archived: false,
            verified: true
          },
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          notionProject: { id: NOTION_FAKE.orkioPage, name: 'Orkio Desktop' }
        }
      ]
    })
  )
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

  await navTo(page, 'Fluxos')
  await page.getByRole('tab', { name: 'Modelos do alva-flow' }).click()
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
  await navTo(p2, 'Fluxos')
  await p2.getByRole('tab', { name: 'Modelos do alva-flow' }).click()
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
  // Em que pé está: spec e plano feitos (lidos do Backlog.md); o código é o próximo.
  await expect(panel.getByTestId('progress-spec')).toHaveAttribute('data-state', 'done')
  await expect(panel.getByTestId('progress-plan')).toHaveAttribute(
    'aria-label',
    'Plano: feito (critérios 0/2)'
  )
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
  await page
    .getByRole('complementary', { name: 'Detalhes de ORK-2' })
    .getByRole('button', { name: 'Fechar' })
    .click()
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
  await expect(card(page).getByTestId('card-flow')).toHaveText('Esperando você')

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
  await page.getByRole('button', { name: 'Atualizar' }).click()
  // Critério 2: a PR aberta move a tarefa para Revisando sozinha (3B), sem parar o fluxo.
  await expectIn(page, 'Revisando')
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

test('5C critério 3: alterações pedidas → Revisado → --comments → push confirmado → novo review → Revisando', async () => {
  const { page, app, logs } = orkio!
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  const pushedSha = git(origin(), 'rev-parse', taskBranch()).trim()

  // Ana pede alterações: a 3B move para Revisado e o fluxo da coluna começa sozinho.
  await setFakes(app, {
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
        ]
      }
    }
  })
  await page.getByRole('button', { name: 'Atualizar' }).click()
  await expectIn(page, 'Revisado')
  await expect(flow).toContainText('Fluxo: Alva: comentários da PR', { timeout: 30_000 })
  // CI vermelho na PR: estado no painel (o botão aparece quando nenhum fluxo está rodando).
  await expect(flow.getByTestId('pr-ci')).toHaveText('CI falhou (PR #7)')

  // O /pr --comments tenta o push: você recusa (o Orkio oferece o próprio push depois).
  const ask = panel.getByRole('group', { name: 'Pedido de aprovação da entrega' })
  await expect(ask).toContainText(`git push origin ${taskBranch()}`, { timeout: 30_000 })
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

  // Pedir review de novo a quem revisou (Ana), depois de confirmar.
  const review = flow.getByRole('group', { name: 'Pedir review da PR #7?' })
  await expect(review).toBeVisible({ timeout: 30_000 })
  expect(git(origin(), 'rev-parse', taskBranch()).trim()).toBe(
    git(worktree(), 'rev-parse', 'HEAD').trim()
  )
  await expect(review.getByRole('checkbox', { name: 'ana' })).toBeChecked()
  await expect(review.getByRole('checkbox', { name: 'bia' })).not.toBeChecked()
  await review.getByRole('button', { name: 'Pedir review' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })
  expect((await notionState(app)).reviewRequests).toEqual([
    { pull: 7, reviewers: ['ana'], teams: [] }
  ])
  // O novo pedido de review leva a tarefa de volta para Revisando (3B), sozinho.
  await expectIn(page, 'Revisando')

  const log = argsLog()
  expect(log.at(-2)).toBe(`deny:git push origin ${taskBranch()}`)
  expect(log.at(-1)).toMatch(/^allow:gh api graphql -f query='mutation \{ resolveReviewThread/)
  expect(ghCalls(userDataDir).at(-1)).toMatch(/^api graphql -f query=mutation/)
  // A sessão mostra as entregas com o link da PR; o histórico completo também.
  const conversation = panel.getByRole('list', { name: 'Conversa da tarefa' })
  await expect(conversation).toContainText('Review pedido na PR #7 pelo Orkio')
  await expect(
    conversation.getByRole('button', { name: 'Abrir a PR #7 no GitHub' }).first()
  ).toBeVisible()
  await expectTaskHistory(
    panel,
    'Conversa de review resolvida',
    'Review pedido na PR #7 pelo Orkio'
  )

  // Com o fluxo parado e o CI vermelho, o painel oferece o fluxo de CI.
  await expect(flow.getByRole('button', { name: 'Rodar fluxo CI vermelho' })).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
  expect(logs.join('\n')).not.toContain(GITHUB_PAT)
})
