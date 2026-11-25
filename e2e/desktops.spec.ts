import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  launchOrkio,
  navTo,
  removeDir,
  seedConfig,
  taskScreen,
  FAKE_REPO,
  type OrkioApp
} from './fixtures'

/**
 * Fase 5 — desktops e divisão lado a lado: criar e trocar de desktop (atalho e seletor), mover
 * uma aba para outro desktop (menu da aba), arranjo em colunas com duas telas montadas, renomear
 * pela paleta e tudo de volta ao reabrir.
 */
const NOTION_TOKEN = 'ntn_E2E_DESKTOPS_TOKEN_abcdef12345'
const PROJECT = 'proj-desktops'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}
const tabs = (page: Page): Locator => page.getByRole('tablist', { name: 'Abas abertas' })
const tabNames = async (page: Page): Promise<string[]> =>
  (await tabs(page).getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
const h1 = (page: Page, name: string): Locator => page.getByRole('heading', { level: 1, name })
/** Painéis da divisão (as telas também têm abas internas com `tabpanel`). */
const panels = (page: Page): Locator =>
  page.getByTestId('desktop-panels').locator(':scope > [role="tabpanel"]')
const current = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Desktop atual: ${name}`, exact: true })

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  const repo = join(work, 'orkio-app')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  git(repo, 'config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# e2e\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/orkio-app.git')
  seedConfig(userDataDir, { id: PROJECT, name: 'orkio-app', localPath: repo, repo: FAKE_REPO })
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('desktops: criar, trocar pelo atalho e mover uma aba', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), NOTION_TOKEN)
  await navTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()
  await expect(current(page, 'Desktop 1')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Quadro', 'Projetos'])

  // Novo desktop (Ctrl+Alt+N): começa com uma aba Início.
  await page.keyboard.press(`${MOD}+Alt+n`)
  await expect(current(page, 'Desktop 2')).toBeVisible()
  await expect(h1(page, 'Por onde começar?')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Nova aba'])

  // Ctrl+Alt+1 volta ao primeiro, com as abas dele.
  await page.keyboard.press(`${MOD}+Alt+1`)
  await expect(current(page, 'Desktop 1')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Quadro', 'Projetos'])

  // Botão direito na aba › Mover para › Desktop 2. Ela some daqui e aparece lá, ativa.
  await tabs(page).getByRole('tab', { name: 'Projetos' }).click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Projetos' })
    .getByRole('menuitem', { name: 'Desktop 2' })
    .click()
  await expect.poll(() => tabNames(page)).toEqual(['Quadro'])
  await expect(current(page, 'Desktop 1')).toBeVisible()
  await page.keyboard.press(`${MOD}+Alt+ArrowRight`)
  await expect(current(page, 'Desktop 2')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Nova aba', 'Projetos'])
  await expect(h1(page, 'Projetos')).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('divisão em colunas: duas telas montadas, clique ativa o painel', async () => {
  const { page } = orkio!
  // Todos os desktops (Ctrl+Shift+D) lista cada um com as abas.
  await page.keyboard.press(`${MOD}+Shift+d`)
  const all = page.getByRole('menu', { name: 'Todos os desktops' })
  await expect(all.getByRole('menuitemradio', { name: /Desktop 1/ })).toContainText('Quadro')
  await all.getByRole('menuitemradio', { name: /Desktop 1/ }).click()
  await expect(current(page, 'Desktop 1')).toBeVisible()

  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()
  await expect(h1(page, 'Quadro')).toBeHidden()

  // Janela › Arranjo: Colunas.
  const menus = page.getByRole('menubar', { name: 'Menus do Orkio' })
  await menus.getByRole('menuitem', { name: 'Janela', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Arranjo: Colunas' }).click()
  await expect(panels(page)).toHaveCount(2)
  // Os dois montados: o Quadro (com os cards) ao lado da tarefa, cada um com a sua barra.
  await expect(
    page.getByRole('tabpanel', { name: 'Quadro' }).getByRole('listitem', { name: ORK2 })
  ).toBeVisible()
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()
  await expect(page.getByTestId('top-bar')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Arranjo: Colunas' })).toBeVisible()

  // Clicar no painel do Quadro o torna a aba ativa.
  const boardTab = tabs(page).getByRole('tab', { name: 'Quadro' })
  await expect(boardTab).toHaveAttribute('aria-selected', 'false')
  await page
    .getByRole('tabpanel', { name: 'Quadro' })
    .getByTestId('top-bar')
    .click({ position: { x: 4, y: 4 } })
  await expect(boardTab).toHaveAttribute('aria-selected', 'true')
  expect(await cspViolations(page)).toEqual([])
})

test('renomear pela paleta e tudo volta ao reabrir', async () => {
  const { page } = orkio!
  await page.keyboard.press(`${MOD}+k`)
  const palette = page.getByRole('dialog', { name: 'Buscar tarefas e comandos' })
  await page.keyboard.type('renomear desktop')
  await palette.getByRole('option', { name: /Renomear desktop/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Renomear desktop' })
  await dialog.getByRole('textbox', { name: 'Nome do desktop' }).fill('Projeto Orkio')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  await expect(current(page, 'Projeto Orkio')).toBeVisible()

  await page.reload()
  await expect(current(page, 'Projeto Orkio')).toBeVisible()
  await expect(panels(page)).toHaveCount(2)
  await expect.poll(() => tabNames(page)).toEqual(['Quadro', ORK2])
  await page.keyboard.press(`${MOD}+Alt+2`)
  await expect(current(page, 'Desktop 2')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Nova aba', 'Projetos'])
  await expect(panels(page)).toHaveCount(1)
  expect(await cspViolations(page)).toEqual([])
})
