import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  CLAUDE_USAGE_TOKEN,
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  navTo,
  openSettings,
  removeDir,
  seedConfig,
  taskScreen,
  writeClaudeCredentials,
  FAKE_REPO,
  type OrkioApp
} from './fixtures'

/**
 * Fase 0 — a casca do app: menus (Sessão, Ir, Janela, Ajuda) do registro de comandos, dock,
 * abas (abrir, fechar, reabrir, mover, restaurar), paleta com ações, sino com "Precisa de você" e
 * "Concluído" + Limpar, e o medidor de uso do Claude (token só no main, desligável).
 */
const NOTION_TOKEN = 'ntn_E2E_SHELL_TOKEN_abcdef1234567'
const PROJECT = 'proj-shell'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const USAGE = {
  five_hour: { utilization: 42, resets_at: new Date(Date.now() + 2 * 3_600_000).toISOString() },
  seven_day: { utilization: 18, resets_at: new Date(Date.now() + 4 * 86_400_000).toISOString() }
}

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
  writeClaudeCredentials(userDataDir)
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('menus da barra e dock vêm do registro; atalhos visíveis', async () => {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN], claudeUsage: USAGE },
    { startPage: 'projects' }
  )
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), NOTION_TOKEN)
  await navTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  const menus = page.getByRole('menubar', { name: 'Menus do Orkio' })
  for (const name of ['Sessão', 'Ir', 'Janela', 'Ajuda']) {
    await expect(menus.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await menus.getByRole('menuitem', { name: 'Janela', exact: true }).click()
  const newTab = page.getByRole('menuitem', { name: /^Nova aba/ })
  await expect(newTab).toBeVisible()
  await expect(newTab).toHaveAttribute('aria-keyshortcuts', /T$/)
  await expect(page.getByRole('menuitem', { name: /^Reabrir aba fechada/ })).toBeDisabled()
  // Setas andam entre os menus (barra de menus de verdade).
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: /^Atalhos do teclado/ })).toBeVisible()
  await page.getByRole('menuitem', { name: /^Atalhos do teclado/ }).click()
  const help = page.getByRole('dialog', { name: 'Atalhos do teclado' })
  await expect(help).toContainText('Fechar aba')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()

  // Dock: Quadro, Tarefas, Agentes e Configurações (e o botão da lista de tarefas fora do grupo).
  const telas = page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('group', { name: 'Telas' })
  await expect(telas.getByRole('button')).toHaveCount(4)
  expect(await cspViolations(page)).toEqual([])
})

test('abas: tarefa em aba própria, fechar/reabrir, Nova aba, mover e restaurar', async () => {
  const { page } = orkio!
  // Configurações › Projetos (por onde o teste entrou) ficou numa aba: fecha pelo ×.
  expect(await tabNames(page)).toEqual(['Quadro', 'Projetos'])
  await page.getByRole('button', { name: 'Fechar aba Projetos' }).click()
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Quadro', 'ORK-2 Listar tarefas do Notion'])
  await expect(tabs(page).getByRole('tab', { name: /ORK-2/ })).toHaveAttribute(
    'aria-selected',
    'true'
  )

  // Voltar ao Quadro pelo dock ativa a aba que já existe (um lugar = uma aba).
  await page
    .getByRole('group', { name: 'Telas' })
    .getByRole('button', { name: 'Quadro', exact: true })
    .click()
  await expect(h1(page, 'Quadro')).toBeVisible()
  expect(await tabNames(page)).toHaveLength(2)

  // Ctrl+W fecha a aba (não a janela); Ctrl+Shift+T reabre.
  await tabs(page).getByRole('tab', { name: /ORK-2/ }).click()
  await page.keyboard.press(`${MOD}+w`)
  await expect(h1(page, 'Quadro')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Quadro'])
  await page.keyboard.press(`${MOD}+Shift+t`)
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()

  // Nova aba = ponto de partida; abrir uma tela daqui transforma a aba.
  await page.keyboard.press(`${MOD}+t`)
  await expect(h1(page, 'Por onde começar?')).toBeVisible()
  await page
    .getByRole('list', { name: 'Começar por' })
    .getByRole('button', { name: /^Agentes/ })
    .click()
  await expect(h1(page, 'Agentes')).toBeVisible()
  expect(await tabNames(page)).toEqual(['Quadro', 'ORK-2 Listar tarefas do Notion', 'Agentes'])

  // Mover pelo teclado e pelo menu Janela.
  await page.keyboard.press(`${MOD}+Shift+PageUp`)
  expect(await tabNames(page)).toEqual(['Quadro', 'Agentes', 'ORK-2 Listar tarefas do Notion'])

  // Fechar pelo ×.
  await tabs(page).locator('..').getByRole('button', { name: 'Fechar aba Agentes' }).click()
  expect(await tabNames(page)).toEqual(['Quadro', 'ORK-2 Listar tarefas do Notion'])

  // Reabrir o app: as abas voltam (e a tela inicial continua sendo o Quadro).
  await page.reload()
  await expect(h1(page, 'Quadro')).toBeVisible()
  await expect.poll(() => tabNames(page)).toEqual(['Quadro', 'ORK-2 Listar tarefas do Notion'])
  expect(await cspViolations(page)).toEqual([])
})

test('paleta faz qualquer coisa: ações do registro (esconder a lista) e Ctrl+B', async () => {
  const { page } = orkio!
  const search = page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: /^Buscar tarefa/ })
  await expect(search).toBeVisible()
  await page.keyboard.press(`${MOD}+k`)
  const palette = page.getByRole('dialog', { name: 'Buscar tarefas e comandos' })
  await page.keyboard.type('esconder lista')
  await palette.getByRole('option', { name: /Esconder lista de tarefas/ }).click()
  await expect(search).toBeHidden()
  await page.keyboard.press(`${MOD}+b`)
  await expect(search).toBeVisible()

  // Ação que navega: a paleta abre Atualizações pelo nome.
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('atualizações')
  await palette.getByRole('option', { name: 'Atualizações', exact: true }).click()
  await expect(h1(page, 'Atualizações')).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('medidor de uso do Claude: % e quando renova; token só no main; dá para esconder', async () => {
  const { app, page } = orkio!
  const meter = page.getByRole('button', { name: /^Uso do Claude: 42% \(janela de 5 h\)/ })
  await expect(meter).toBeVisible()
  await meter.click()
  const windows = page.getByRole('list', { name: 'Janelas de uso' })
  await expect(windows).toContainText('Janela de 5 h')
  await expect(windows).toContainText('Semana')
  await expect(windows).toContainText('18%')
  // O token foi para a Anthropic (no main) e nunca para a tela.
  const calls = await externalCalls(app)
  expect(calls.some((c) => c.url.startsWith('https://api.anthropic.com/api/oauth/usage'))).toBe(
    true
  )
  expect(await page.content()).not.toContain(CLAUDE_USAGE_TOKEN)
  expect(JSON.stringify(await page.evaluate(() => window.orkio.usage.claude()))).not.toContain(
    CLAUDE_USAGE_TOKEN
  )

  await page.getByRole('button', { name: 'Esconder o medidor' }).click()
  await expect(meter).toBeHidden()
  // Religa nas Configurações › Provedores e uso.
  await openSettings(page, 'Provedores e uso')
  const toggle = page.getByRole('switch', { name: /Mostrar o uso do Claude na barra/ })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(meter).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('sino: "Precisa de você" e "Concluído" com Limpar', async () => {
  const { page } = orkio!
  const started = await page.evaluate(async (projectId) => {
    const tasks = await window.orkio.notionWorkspace.listTasks(projectId)
    if (!tasks.ok) return tasks.error.message
    const task = tasks.value.tasks.find((t) => t.displayId === 'ORK-2')
    if (!task) return 'sem ORK-2'
    const saved = await window.orkio.taskFlows.saveFlows(projectId, [
      {
        id: 'so-gate',
        name: 'Só aprovação',
        steps: [
          {
            id: 'ok',
            name: 'Aprovar entrega',
            type: 'gate',
            message: 'Pode seguir?',
            show: 'none',
            onReject: 'stop',
            timeoutMin: null
          }
        ]
      }
    ])
    if (!saved.ok) return saved.error.message
    const run = await window.orkio.taskFlows.startById(projectId, task.id, 'so-gate')
    return run.ok ? 'ok' : run.error.message
  }, PROJECT)
  expect(started).toBe('ok')

  const bell = page.getByRole('button', { name: '1 esperando você' })
  await expect(bell).toBeVisible({ timeout: 15_000 })
  await bell.click()
  const needs = page.getByRole('group', { name: 'Precisa de você' })
  await needs.getByRole('menuitem', { name: /ORK-2 · Listar tarefas do Notion/ }).click()
  const gate = taskScreen(page, 'ORK-2')
    .getByRole('region', { name: 'Fluxo da tarefa' })
    .getByRole('group', { name: 'Aprovação do fluxo' })
  await gate.getByRole('button', { name: 'Aprovar' }).click()

  const idle = page.getByRole('button', { name: 'Nada esperando você' })
  await expect(idle).toBeVisible({ timeout: 15_000 })
  await idle.click()
  const done = page.getByRole('group', { name: 'Concluído' })
  await expect(
    done.getByRole('menuitem', { name: /ORK-2 · Listar tarefas do Notion/ })
  ).toContainText('Fluxo concluído', { timeout: 15_000 })
  await done.getByRole('menuitem', { name: /Limpar concluídos/ }).click()
  await expect(done).toContainText('Nada concluído por enquanto')
  await page.keyboard.press('Escape')
  expect(await cspViolations(page)).toEqual([])
})
