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
  type OrkioApp,
  taskScreen,
  FAKE_REPO,
  seedConfig
} from './fixtures'

/**
 * Esperando você (antes a Visão geral, 6D): com Notion/GitHub/Claude simulados e git real, um gate
 * de fluxo pendente aparece no sino e na lista lateral, o sino abre a tarefa no fluxo e, ao
 * aprovar, o item some. Também: atalhos e abertura direto no Quadro.
 */
const NOTION_TOKEN = 'ntn_E2E_OVERVIEW_TOKEN_abcdef123456'
const PROJECT = 'proj-overview'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}

function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Navegação principal' })
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git(work, 'init', '-q', '--bare', '-b', 'main', join(work, 'origin.git'))
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
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
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

function bell(page: Page): Locator {
  return page.getByRole('button', { name: /esperando você$/ })
}

test('gate pendente aparece no sino e na lista lateral, abre a tarefa no fluxo e some ao aprovar', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')

  // Quadro criado pela tela (etapas do template).
  await navTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  // Nada esperando ainda.
  await expect(page.getByRole('button', { name: 'Nada esperando você' })).toBeVisible()

  // Um fluxo só com um gate, iniciado à mão na ORK-2.
  const started = await page.evaluate(async (projectId) => {
    const tasks = await window.orkio.notionWorkspace.listTasks(projectId)
    if (!tasks.ok) return { ok: false as const, why: tasks.error.message }
    const task = tasks.value.tasks.find((t) => t.displayId === 'ORK-2')
    if (!task) return { ok: false as const, why: 'sem ORK-2' }
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
    if (!saved.ok) return { ok: false as const, why: saved.error.message }
    const run = await window.orkio.taskFlows.startById(projectId, task.id, 'so-gate')
    return run.ok ? { ok: true as const } : { ok: false as const, why: run.error.message }
  }, PROJECT)
  expect(started).toEqual({ ok: true })

  // Aparece sozinho (overview:changed): contador no sino e a tarefa em "Esperando você".
  await expect(page.getByRole('button', { name: '1 esperando você' })).toBeVisible({
    timeout: 15_000
  })
  const sidebarItem = nav(page)
    .getByRole('group', { name: 'Esperando você' })
    .getByRole('button', { name: /^ORK-2 · Listar tarefas do Notion/ })
  await expect(sidebarItem).toBeVisible()

  // O sino lista o que falta e abre a tarefa na seção do fluxo.
  await bell(page).click()
  await page.getByRole('menuitem', { name: /ORK-2 · Listar tarefas do Notion/ }).click()
  const screen = taskScreen(page, 'ORK-2')
  await expect(screen).toBeVisible()
  const gate = screen
    .getByRole('region', { name: 'Fluxo da tarefa' })
    .getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toBeVisible()
  await gate.getByRole('button', { name: 'Aprovar' }).click()
  await expect(screen.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 15_000 })

  // O item sumiu do sino e da lista lateral.
  await expect(page.getByRole('button', { name: 'Nada esperando você' })).toBeVisible({
    timeout: 15_000
  })
  await expect(sidebarItem).toHaveCount(0)

  expect(await cspViolations(page)).toEqual([])
})

test('com projeto configurado, o app abre direto no Quadro (sem Primeiros passos)', async () => {
  const { page } = orkio!
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Quadro' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Primeiros passos' })).toHaveCount(0)
  // Atalhos na ordem do menu: Quadro, Tarefas, Agentes, Configurações.
  await page.keyboard.press(`${MOD}+4`)
  await expect(page.getByRole('heading', { level: 1, name: 'Integrações' })).toBeVisible()
  await page.keyboard.press(`${MOD}+1`)
  await expect(page.getByRole('heading', { level: 1, name: 'Quadro' })).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})
