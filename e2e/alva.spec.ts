import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  launchOrkio,
  removeDir,
  type OrkioApp
} from './fixtures'

/**
 * Etapa 5B: integração alva-flow com o Claude Code SIMULADO imitando o plugin (cria e muda
 * backlog/tasks/task-1 - …md), Notion simulado e git real. Nada do plugin real roda aqui.
 */
const NOTION_TOKEN = 'ntn_E2E_ALVA_TOKEN_abcdef123456'
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
          priority: { id: 'pri', name: 'Prioridade', type: 'select' }
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
  await goToBoard(page)
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(card(page)).toBeVisible()

  await page.getByRole('button', { name: 'alva-flow', exact: true }).click()
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
  await p2.getByRole('button', { name: 'alva-flow', exact: true }).click()
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
  await alva.getByRole('button', { name: 'Voltar ao quadro' }).click()

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

  // Vínculo + plano: para no gate "Aprovar plano".
  await expect(flow.getByTestId('flow-status')).toHaveText('Esperando aprovação', {
    timeout: 30_000
  })
  await expect(flow.getByTestId('alva-task')).toHaveText(
    'Backlog: TASK-1 · Architected · critérios 0/2'
  )
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
  expect(await cspViolations(page)).toEqual([])
})

test('critérios 3–5: entrega com blocker → fix (1 volta), diff, commit e para antes do push (5C)', async () => {
  const { page } = orkio!
  await page
    .getByRole('complementary', { name: 'Detalhes de ORK-2' })
    .getByRole('button', { name: 'Fechar' })
    .click()
  await moveTo(page, 'Em andamento')
  const panel = await flowPanel(page)
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })

  // Review com blocker → /fix → review limpo → gate do diff.
  const gate = flow.getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toContainText('Confira o diff antes do commit', { timeout: 60_000 })
  await expect(gate.getByRole('textbox', { name: 'Diff para aprovar' })).toHaveValue(/corrigido/)
  const log = argsLog()
  expect(log.slice(2)).toEqual([
    'implement TASK-1',
    'review TASK-1',
    'fix TASK-1 --apply',
    'review TASK-1'
  ])
  await gate.getByRole('button', { name: 'Aprovar' }).click()

  // Commit e para no push pendente da 5C, explicando.
  const pending = flow.getByRole('group', { name: 'Ação pendente do fluxo' })
  await expect(pending).toContainText('Push da branch', { timeout: 30_000 })
  await expect(pending).toContainText('chega na Etapa 5C')
  expect(argsLog().at(-1)).toBe('commit TASK-1')
  expect(git(worktree(), 'log', '--oneline', '-1')).toContain('feat: exportar tarefas')
  // Nada foi enviado ao origin.
  expect(git(join(work, 'origin.git'), 'branch', '--list').trim()).toBe('* main')
  await expect(card(page).getByTestId('card-flow')).toHaveText('Esperando você')
  await expect(flow.getByTestId('alva-task')).toContainText('Backlog: TASK-1 · Reviewed')
})
