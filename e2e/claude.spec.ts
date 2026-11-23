import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  NOTION_TASK_IDS,
  launchOrkio,
  notionState,
  removeDir,
  type OrkioApp,
  navTo,
  taskScreen,
  taskTab
} from './fixtures'

/**
 * Etapa 4A com o Claude Code SIMULADO (e2e/fake-claude/claude) e a ponte de permissões real.
 * Git real: repositório "do usuário" + origin local (bare).
 */
const NOTION_TOKEN = 'ntn_E2E_CLAUDE_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []
const repoDir = (): string => join(work, 'orkio-app')
const originDir = (): string => join(work, 'origin.git')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
async function open(claude: { loggedIn?: boolean } = {}): Promise<OrkioApp> {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN] },
    { startPage: 'integrations', claude }
  )
  return orkio
}
async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}
async function goTo(page: Page, name: 'Quadro' | 'Integrações'): Promise<void> {
  await navTo(page, name)
}
function card(page: Page): Locator {
  return page.getByRole('listitem', { name: ORK2, exact: true })
}
function panelOf(page: Page): Locator {
  return taskScreen(page, 'ORK-2')
}
/** Abre a tarefa no Quadro e devolve a sessão (conversa + campo de mensagem). */
async function openPanel(page: Page): Promise<Locator> {
  await goTo(page, 'Quadro')
  await card(page).click()
  const panel = panelOf(page)
  await expect(panel).toBeVisible()
  return session(page)
}
function session(page: Page): Locator {
  return panelOf(page).getByRole('region', { name: 'Sessão da tarefa' })
}
/** Aba do painel da fase (Mudanças, Detalhes); "Sessão" é a conversa, sempre visível. */
async function tab(page: Page, name: 'Sessão' | 'Mudanças' | 'Detalhes'): Promise<Locator> {
  return taskTab(panelOf(page), name)
}
/** A execução mais recente na conversa (a que fica aberta). */
function lastRun(section: Locator): Locator {
  return section.getByTestId('session-run').last()
}
/** Histórico completo (recolhido na aba Detalhes). */
async function history(page: Page): Promise<Locator> {
  const details = await tab(page, 'Detalhes')
  const list = details.getByRole('list', { name: 'Histórico da tarefa' })
  if (!(await list.isVisible())) await details.getByText('Histórico completo').click()
  return list
}
function argsLog(): Record<string, unknown>[] {
  const wt = join(userDataDir, 'worktrees', 'proj-claude', 'ORK-2', '.orkio', 'agent-args.log')
  return readFileSync(wt, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git(work, 'init', '-q', '--bare', '-b', 'main', originDir())
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', originDir())
  git(repoDir(), 'push', '-q', 'origin', 'main')
  // Mudança NÃO commitada do usuário na pasta principal: o Orkio não pode tocar nela.
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n\nrascunho do usuário\n')

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
          id: 'proj-claude',
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

test('card do Claude Code: versão e login, sem e-mail nem credenciais', async () => {
  const { page } = await open()
  const claudeCard = page.getByRole('region', { name: 'Claude Code' })
  await expect(claudeCard.getByTestId('claude-version')).toHaveText('2.1.9')
  await expect(claudeCard).toContainText('Logado (assinatura)')
  await expect(page.locator('body')).not.toContainText('nao-mostrar@example.com')

  // Prepara o Notion e o quadro.
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')
  await goTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(card(page)).toBeVisible()
})

test('roda numa branch isolada: briefing, aprovação, pergunta, bloqueios e resumo', async () => {
  const { page } = orkio!
  const section = await openPanel(page)
  await expect(section.getByTestId('session-context')).toContainText(
    'Começa uma sessão nova com o resumo da tarefa no Notion.'
  )
  await section.getByRole('button', { name: 'Nova sessão…' }).click()

  await expect(section.getByTestId('run-branch')).toHaveText('feat/ORK-2-listar-tarefas-do-notion')
  const briefing = section.getByRole('textbox', { name: /^Resumo da tarefa/ })
  await expect(briefing).toHaveValue(
    /## Critérios de aceite\n\n- Gera um arquivo \.csv\n {2}Detalhe aninhado/
  )
  await expect(briefing).toHaveValue(/# ORK-2 — Listar tarefas do Notion/)
  await expect(section).toContainText('não foram convertidos: audio')

  await section
    .getByRole('textbox', { name: /^O que o Claude Code deve fazer/ })
    .fill('Implemente: pedir-shell perguntar tentar-push ler-env')
  await section.getByRole('button', { name: 'Rodar', exact: true }).click()

  // Shell pede aprovação (no fim da sessão, e o topo avisa): "sempre neste projeto".
  await expect(
    panelOf(page).getByRole('status').filter({ hasText: 'esperando você' })
  ).toBeVisible()
  const approval = section.getByRole('group', { name: 'Pedido de aprovação' })
  await expect(approval).toContainText('npm test')
  await approval.getByRole('button', { name: 'Sempre neste projeto: npm test' }).click()

  // Pergunta do Claude: resposta volta para o CLI.
  const question = section.getByRole('group', { name: 'Pergunta do Claude Code' })
  await question.getByRole('radio', { name: 'Ponto e vírgula' }).check()
  await question.getByRole('button', { name: 'Responder' }).click()

  const run = lastRun(section)
  await expect(run.getByTestId('run-status')).toHaveText('Concluída', { timeout: 30_000 })
  const log = run.getByRole('list', { name: 'Log da execução' })
  await expect(log).toContainText('com critérios')
  await expect(log).toContainText('push: deny')
  await expect(log).toContainText('fora: deny')
  await expect(log).toContainText('shell: allow')
  await expect(log).toContainText('resposta: Ponto e vírgula')
  await expect(log).toContainText('Bloqueado: git push origin HEAD')
  await expect(log).not.toContainText('VAZOU')
  await expect(log).not.toContainText('valor-super-secreto')
  await expect(log).not.toContainText('abcdefghijklmnop')
  await expect(run.getByTestId('run-summary')).toContainText('1 commit')
  await expect(run.getByTestId('run-summary')).toContainText('npm test')
  // O que a execução mudou fica logo abaixo da conversa: arquivos, commits e o diff.
  await expect(run.getByRole('list', { name: 'Arquivos alterados' })).toContainText(
    'src/exportar.ts'
  )
  await expect(run.getByRole('list', { name: 'Commits' })).toContainText(
    'feat: exportar CSV (simulado)'
  )
  await run.getByRole('button', { name: 'Ver o diff da tarefa' }).click()
  await expect(run.getByRole('region', { name: 'Diff da tarefa' })).toContainText('src/exportar.ts')

  // Em que pé está: código em andamento, com o commit.
  await expect(panelOf(page).getByTestId('progress-code')).toHaveAttribute('aria-label', /1 commit/)

  // Mudanças: arquivos e ambiente.
  const changes = await tab(page, 'Mudanças')
  await expect(changes.getByTestId('changes-summary')).toContainText('1 commit')
  await expect(changes).toContainText('src/exportar.ts')
  await expect(changes.getByTestId('workspace-branch')).toHaveText(
    'feat/ORK-2-listar-tarefas-do-notion'
  )
  await tab(page, 'Sessão')

  // Pasta principal intocada: mesma branch, mesma mudança não commitada, nenhum arquivo novo.
  expect(git(repoDir(), 'branch', '--show-current').trim()).toBe('main')
  expect(git(repoDir(), 'status', '--porcelain').trim()).toBe('M README.md')
  // Nada foi enviado ao origin.
  expect(git(originDir(), 'branch', '--list').trim()).toBe('* main')

  // Log em disco sem segredos (nem o .env lido pelo agente, nem a chave do ambiente).
  const runsDir = join(userDataDir, 'runs')
  const disk = readdirSync(runsDir)
    .map((f) => readFileSync(join(runsDir, f), 'utf8'))
    .join('\n')
  expect(disk).toContain('shell: allow')
  expect(disk).not.toContain('valor-super-secreto')
  expect(disk).not.toContain('sk-ant-api03')
  expect(disk).not.toContain('E2E-NAO-PODE-VAZAR')

  // Histórico completo da tarefa (na aba Detalhes).
  const list = await history(page)
  await expect(list).toContainText('Claude Code iniciou uma execução')
  await expect(list).toContainText('Claude Code terminou')
  await expect(list).toContainText('Claude Code bloqueado')
  await tab(page, 'Sessão')
})

test('mensagem no campo continua a mesma sessão (--resume), sem repetir o briefing', async () => {
  const { page } = orkio!
  const section = session(page)
  await expect(section.getByTestId('session-context')).toContainText(
    'Continua a sessão na pasta de trabalho da tarefa.'
  )
  const first = argsLog().at(-1)!
  await section
    .getByRole('textbox', { name: 'Mensagem para o Claude Code' })
    .fill('Agora troque o separador por vírgula')
  await section.getByRole('button', { name: 'Enviar' }).click()
  const run = lastRun(section)
  await expect(run).toContainText('Agora troque o separador por vírgula')
  await expect(run.getByTestId('run-status')).toHaveText('Concluída', { timeout: 30_000 })
  await expect(run.getByRole('list', { name: 'Log da execução' })).toContainText(
    'Continuei a sessão: Agora troque o separador por vírgula'
  )
  const resumed = argsLog().at(-1)!
  expect(resumed['resume']).toBe(first['sessionId'])
  expect(resumed['sessionId']).toBeNull()
  expect(resumed['briefingInPrompt']).toBe(false)
  // A execução anterior continua inteira na conversa (as respostas do Claude, não um resumo).
  await expect(section.getByTestId('session-run')).toHaveCount(2)
  await expect(
    section.getByTestId('session-run').first().getByRole('list', { name: 'Log da execução' })
  ).toContainText('com critérios')
})

test('"sempre neste projeto" vale na próxima execução; parar encerra', async () => {
  const { page } = orkio!
  const section = session(page)
  await section
    .getByRole('textbox', { name: 'Mensagem para o Claude Code' })
    .fill('pedir-shell demorar')
  await section.getByRole('button', { name: 'Enviar' }).click()

  const run = lastRun(section)
  const log = run.getByRole('list', { name: 'Log da execução' })
  await expect(log).toContainText('shell: allow')
  await expect(section.getByRole('group', { name: 'Pedido de aprovação' })).toHaveCount(0)
  await expect(log).toContainText('Trabalhando por um bom tempo')
  await expect(section.getByTestId('task-working')).toContainText('Claude Code trabalhando há')
  await section.getByRole('button', { name: 'Parar' }).click()
  await expect(run.getByTestId('run-status')).toHaveText('Cancelada', { timeout: 20_000 })
  await expect(await history(page)).toContainText('Execução do Claude Code cancelada')
  await tab(page, 'Sessão')
  await expect(section.getByTestId('session-run')).toHaveCount(3)
})

test('catálogo de comandos: "/" sugere no campo; nova sessão agrupada, com busca', async () => {
  const { page } = orkio!
  const section = session(page)
  const field = section.getByRole('textbox', { name: 'Mensagem para o Claude Code' })
  await field.fill('/rev')
  const suggestions = section.getByRole('list', { name: 'Comandos sugeridos' })
  await expect(suggestions).toContainText('/revisar')
  await suggestions.getByText('/revisar').click()
  await expect(field).toHaveValue('/revisar ')
  await field.fill('')

  await section.getByRole('button', { name: 'Nova sessão…' }).click()
  await section.getByRole('radio', { name: 'Comando instalado' }).click()
  await section.getByRole('button', { name: /^Comando/ }).click()
  await expect(page.getByText('Seus comandos')).toBeVisible()
  await page.getByRole('option', { name: /\/revisar/ }).click()
  await expect(section).not.toContainText('CORPO')
  await section.getByRole('button', { name: 'Recarregar' }).click()
  await section.getByRole('button', { name: 'Rodar', exact: true }).click()
  await expect(lastRun(section).getByTestId('run-status')).toHaveText('Concluída', {
    timeout: 30_000
  })
  await expect(lastRun(section)).toContainText('/revisar')
})

test('"Rodar de novo" reabre com o mesmo comando; artefato anexado e publicado no Notion', async () => {
  const { app, page } = orkio!
  const section = session(page)
  // A execução mais recente é a do /revisar (teste anterior).
  await lastRun(section).getByRole('button', { name: 'Rodar de novo' }).click()
  await expect(section.getByRole('radio', { name: 'Comando instalado' })).toBeChecked()
  await expect(section.getByRole('button', { name: 'Comando /revisar' })).toBeVisible()
  await section.getByRole('button', { name: 'Cancelar', exact: true }).click()

  await section.getByRole('textbox', { name: 'Mensagem para o Claude Code' }).fill('escrever-doc')
  await section.getByRole('button', { name: 'Enviar' }).click()
  await expect(lastRun(section).getByTestId('run-status')).toHaveText('Concluída', {
    timeout: 30_000
  })

  const changes = await tab(page, 'Mudanças')
  const artifacts = changes.getByRole('region', { name: 'Documentos para o Notion' })
  await artifacts.getByRole('button', { name: 'Anexar docs/exportar.md' }).click()
  const attached = artifacts.getByRole('list', { name: 'Documentos anexados' })
  await expect(attached).toContainText('docs/exportar.md')

  // Subpágina: confirmação antes de publicar.
  await attached.getByRole('button', { name: 'Publicar docs/exportar.md como subpágina' }).click()
  const confirm = artifacts.getByRole('alertdialog', { name: 'Confirmar publicação' })
  await expect(confirm).toContainText('subpágina da tarefa')
  await confirm.getByRole('button', { name: 'Publicar', exact: true }).click()
  await expect(artifacts.getByText('publicado no Notion')).toBeVisible()
  await expect(attached).toContainText('No Notion (subpágina)')

  await attached.getByRole('button', { name: 'Publicar docs/exportar.md como seção' }).click()
  await artifacts
    .getByRole('alertdialog', { name: 'Confirmar publicação' })
    .getByRole('button', { name: 'Publicar', exact: true })
    .click()
  await expect(attached).toContainText('No Notion (seção)')
  await tab(page, 'Sessão')

  const published = (await notionState(app)).published
  expect(published.map((p) => [p.kind, p.parent])).toEqual([
    ['child_page', NOTION_TASK_IDS.ork2],
    ['section', NOTION_TASK_IDS.ork2]
  ])
  expect(published[0]!.title).toBe('Exportar CSV')
  expect(published[0]!.markdown).toContain('Separador ponto e vírgula')
  expect(published[1]!.markdown).toContain('## exportar.md')
  for (const p of published) expect(p.markdown).not.toContain('ghp_abcdef')
})

test('ver diff e limpar ambiente (a branch fica)', async () => {
  const { page } = orkio!
  const changes = await tab(page, 'Mudanças')
  await changes.getByRole('button', { name: 'Ver diff' }).click()
  const diff = changes.getByRole('region', { name: 'Diff da pasta de trabalho' })
  await expect(diff).toContainText('src/exportar.ts')
  await expect(diff).toContainText('arquivo')
  await expect(diff).toContainText('+')
  await changes.getByRole('button', { name: 'Limpar pasta de trabalho' }).click()
  await expect(changes.getByTestId('workspace-branch')).toHaveCount(0)
  expect(git(repoDir(), 'branch', '--list', 'feat/ORK-2-*').trim()).toBe(
    'feat/ORK-2-listar-tarefas-do-notion'
  )
  expect(git(repoDir(), 'status', '--porcelain').trim()).toBe('M README.md')
  expect(await cspViolations(page)).toEqual([])
})

test('sem login no Claude Code: card avisa e mandar mensagem mostra erro claro', async () => {
  await close()
  const { page } = await open({ loggedIn: false })
  const claudeCard = page.getByRole('region', { name: 'Claude Code' })
  await expect(claudeCard).toContainText('Não logado')
  const section = await openPanel(page)
  await section.getByRole('textbox', { name: 'Mensagem para o Claude Code' }).fill('x')
  await section.getByRole('button', { name: 'Enviar' }).click()
  await expect(section.getByRole('alert')).toContainText('não está logado')
  await close()
  const joined = allLogs.join('\n')
  expect(joined).not.toContain(NOTION_TOKEN)
  expect(joined).not.toContain('E2E-NAO-PODE-VAZAR')
})
