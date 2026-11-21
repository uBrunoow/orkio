import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
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
 * Etapa 6D: Visão geral com Notion/GitHub/Claude simulados e git real. Um gate de fluxo pendente
 * aparece em "Esperando você" (e no contador do menu), "Abrir" leva ao painel da tarefa no fluxo,
 * e ao aprovar o item some. Também: atalho de teclado e abertura direto na Visão geral.
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
function waitingRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'Esperando você' })
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
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('gate pendente aparece em "Esperando você", abre a tarefa no fluxo e some ao aprovar', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')

  // Quadro criado pela tela (etapas do template).
  await nav(page).getByRole('button', { name: 'Quadro' }).click()
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  // Visão geral pelo atalho: nada esperando ainda.
  await page.keyboard.press(`${MOD}+1`)
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
  await expect(waitingRegion(page)).toContainText('Nada esperando por você agora.')
  // Cartão do projeto: mini barra por etapa e total de tarefas do quadro.
  const projectCard = page
    .getByRole('region', { name: 'Por projeto' })
    .getByRole('group', { name: 'orkio-app' })
  await expect(
    projectCard.getByRole('progressbar', { name: /^Prioridades: \d+ de 2$/ })
  ).toBeVisible()
  await expect(projectCard).toContainText('2 tarefa(s)')

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

  // Aparece sozinho (overview:changed), com ID, título, projeto e o que falta; contador no menu.
  const item = waitingRegion(page).getByTestId('waiting-item')
  await expect(item).toHaveCount(1, { timeout: 15_000 })
  await expect(item).toContainText('ORK-2')
  await expect(item).toContainText('Listar tarefas do Notion')
  await expect(item).toContainText('orkio-app · Aprovação no fluxo: Aprovar entrega')
  // A coluna de ícones não tem contador; ele fica no sino da barra superior.
  await expect(
    page
      .getByRole('navigation', { name: 'Barra superior' })
      .getByRole('button', { name: '1 esperando você' })
  ).toBeVisible()

  // "Abrir" leva ao painel da tarefa, na seção do fluxo.
  await item.getByRole('button', { name: 'Abrir' }).click()
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  await expect(panel).toBeVisible()
  const gate = panel
    .getByRole('region', { name: 'Fluxo da tarefa' })
    .getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toBeInViewport()
  await gate.getByRole('button', { name: 'Aprovar' }).click()
  await expect(panel.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 15_000 })

  // De volta à Visão geral: o item sumiu, o contador também; a atividade registra o fluxo.
  await nav(page)
    .getByRole('button', { name: /^Visão geral/ })
    .click()
  await expect(waitingRegion(page)).toContainText('Nada esperando por você agora.')
  await expect(nav(page).getByLabel(/esperando você/)).toHaveCount(0)
  const activity = page.getByRole('list', { name: 'Atividade recente' })
  await expect(activity).toContainText('Fluxo concluído')
  await expect(activity).toContainText('Aprovação concedida')

  expect(await cspViolations(page)).toEqual([])
})

test('com projeto configurado, o app abre direto na Visão geral (sem "Vamos começar")', async () => {
  const { page } = orkio!
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Começar', exact: true })).toHaveCount(0)
  // Atalhos na ordem do menu.
  await page.keyboard.press(`${MOD}+6`)
  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible()
  await page.keyboard.press(`${MOD}+1`)
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})
