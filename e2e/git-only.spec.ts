/**
 * Projeto só com git local (entrega 2): sem a conexão do GitHub do Orkio, as PRs vêm pelo `gh`
 * do usuário (simulado em e2e/fake-gh) e as automações do quadro andam como com o app conectado.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  FAKE_REPO,
  NOTION_TASK_IDS,
  createUserDataDir,
  cspViolations,
  ghCalls,
  launchOrkio,
  removeDir,
  seedConfig,
  setGhState,
  setNotionStatus,
  type FakeGhState,
  type OrkioApp
} from './fixtures'

const NOTION_TOKEN = 'ntn_E2E_GITONLY_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const GH: FakeGhState = { loggedIn: true, login: 'e2e-user', branches: ['main'], pulls: [] }

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repoDir(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}
function column(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Etapas do quadro' })
    .getByRole('listitem', { name, exact: true })
}
async function expectIn(page: Page, stage: string, timeout = 10_000): Promise<void> {
  await expect(column(page, stage).getByRole('listitem', { name: ORK2, exact: true })).toBeVisible({
    timeout
  })
}
async function refresh(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Atualizar' }).click()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('remote', 'add', 'origin', 'https://github.com/acme/orkio-app.git')
  seedConfig(userDataDir, {
    id: 'proj-git',
    name: 'orkio-app',
    localPath: repoDir(),
    repo: { ...FAKE_REPO, verified: false, visibility: 'unknown', canPush: null, access: 'git' }
  })
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('só git local: a PR aberta (lida pelo gh, sem o GitHub do Orkio) move para Revisando', async () => {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN], githubBranches: ['main'] },
    { startPage: 'projects', ghApi: GH }
  )
  const { app, page } = orkio
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')
  await setNotionStatus(app, NOTION_TASK_IDS.ork2, 'Prioridades')
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
    .click()
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expectIn(page, 'Prioridades')
  // Linha de base (com a tarefa já no quadro): lê pelo gh e nada se move.
  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const h = await window.orkio.board.history('proj-git', id)
        return h.ok && h.value.some((e) => e.kind === 'added')
      }, NOTION_TASK_IDS.ork2)
    )
    .toBe(true)
  await page.evaluate(() => window.orkio.automation.runNow('proj-git'))
  await expect
    .poll(() => ghCalls(userDataDir).some((c) => c.includes('/pulls?state=open')))
    .toBe(true)
  await expect(page.getByText(/Projeto só com git local/)).toHaveCount(0)
  await expectIn(page, 'Prioridades')

  git('checkout', '-q', '-b', 'ORK-2/listar')
  await expectIn(page, 'Em andamento', 15_000)

  setGhState(userDataDir, {
    ...GH,
    branches: ['main', 'ORK-2/listar'],
    pulls: [
      {
        number: 7,
        title: 'ORK-2 Listar tarefas',
        head: 'ORK-2/listar',
        state: 'open',
        updatedAt: '2026-11-19T10:00:00Z'
      }
    ]
  })
  await refresh(page)
  await expectIn(page, 'Revisando')
  expect(await cspViolations(page)).toEqual([])
})

test('gh sem login: o quadro diz o motivo e continua só com as branches locais', async () => {
  const { page } = orkio!
  setGhState(userDataDir, { ...GH, loggedIn: false })
  // O login do gh fica 1 min em cache: reabrir o app lê de novo.
  await orkio!.app.close()
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN], githubBranches: ['main'] },
    { startPage: 'projects', ghApi: { ...GH, loggedIn: false } }
  )
  void page
  await orkio.page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
    .click()
  await refresh(orkio.page)
  await expect(orkio.page.getByText(/rode gh auth login/).first()).toBeVisible()
})
