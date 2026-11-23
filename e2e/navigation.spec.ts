import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  launchOrkio,
  navTo,
  removeDir,
  openedUrls,
  type OrkioApp,
  expectTaskHistory,
  taskScreen,
  boardSettingsTab
} from './fixtures'

/**
 * 6E: navegação reorganizada. Cada tela do projeto é um item do menu (Quadro, Etapas e
 * automações, Fluxos, Contexto do Claude); clicar num item sai de qualquer subtela; a tarefa
 * abre no painel e em tela cheia.
 */
const TOKEN = 'ntn_E2E_NAV_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name })

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
          assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
        },
        updatedAt: '2026-11-19T00:00:00.000Z'
      },
      projects: [
        {
          id: 'proj-nav',
          name: 'orkio-app',
          localPath: repo,
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

function telas(page: Page) {
  return page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('group', { name: 'Telas' })
}

test('menu com três telas; Configurações reúne as telas do projeto e sai das subtelas', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), TOKEN)

  // O menu principal tem só Quadro, Agentes e Configurações.
  await expect(telas(page).getByRole('button')).toHaveCount(3)
  for (const name of ['Quadro', 'Agentes', 'Configurações']) {
    await expect(telas(page).getByRole('button', { name, exact: true })).toBeVisible()
  }

  // Sem quadro: Quadro e automações pede para criá-lo.
  await navTo(page, 'Quadro e automações')
  await expect(page.getByRole('heading', { name: 'Crie o quadro primeiro' })).toBeVisible()
  await page.getByRole('button', { name: 'Ir para o Quadro' }).click()
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  // Subtela; clicar no mesmo item volta ao começo da tela.
  await navTo(page, 'Quadro e automações')
  await expect(h1(page, 'Quadro e automações')).toBeVisible()
  await page.getByRole('button', { name: 'Mais ações do fluxo' }).click()
  await page.getByRole('menuitem', { name: 'Etapa Orkio e Bloqueada…' }).click()
  await expect(page.getByRole('heading', { name: 'Ajustar quadro' })).toBeVisible()
  await navTo(page, 'Quadro e automações')
  await expect(page.getByRole('button', { name: 'Mais ações do fluxo' })).toBeVisible()

  // Entrega é uma aba de Quadro e automações; grava na hora.
  await boardSettingsTab(page, 'Entrega')
  const approval = page
    .getByRole('region', { name: 'Entrega' })
    .getByRole('checkbox', { name: 'Exigir minha aprovação para push' })
  await expect(approval).toBeChecked()
  await approval.click()
  await expect(approval).not.toBeChecked()
  await navTo(page, 'Quadro e automações')
  await boardSettingsTab(page, 'Entrega')
  await expect(approval).not.toBeChecked()
  await approval.click()
  await expect(approval).toBeChecked()

  // Fluxos (com os modelos do alva-flow) também é uma aba.
  await boardSettingsTab(page, 'Fluxos')
  await expect(page.getByRole('region', { name: 'Fluxos do projeto' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Modelos do alva-flow' })).toBeVisible()
  // Contexto do Claude não existe mais.
  await expect(page.getByRole('button', { name: 'Contexto do Claude' })).toHaveCount(0)
  await navTo(page, 'Quadro')
  await expect(h1(page, 'Quadro')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  expect(await cspViolations(page)).toEqual([])
})

test('tarefa: tela com fases, conversa e painel; janela estreita; tarefa que sumiu', async () => {
  const { app, page } = orkio!
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const task = taskScreen(page, 'ORK-2')
  await expect(task).toBeVisible()
  await expect(h1(page, 'Listar tarefas do Notion')).toBeVisible()
  // Fases na barra do topo (fora da região da tela).
  await expect(
    page.getByTestId('top-bar').getByRole('list', { name: 'Fases da tarefa' })
  ).toBeVisible()
  const session = task.getByRole('region', { name: 'Sessão da tarefa' })
  await expect(session.getByRole('list', { name: 'Conversa da tarefa' })).toContainText(
    'Entrou no quadro'
  )
  await expect(session.getByRole('textbox', { name: /^Mensagem para/ })).toBeVisible()
  const panel = task.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  await expect(panel.getByRole('tab')).toHaveCount(3)
  for (const name of ['Mudanças', 'PR & CI', 'Detalhes']) {
    await expect(panel.getByRole('tab', { name, exact: true })).toBeVisible()
  }
  await expectTaskHistory(task, 'Entrou no quadro')
  await expect(telas(page).getByRole('button', { name: 'Quadro' })).toHaveAttribute(
    'aria-current',
    'page'
  )

  // Janela estreita: o painel vai para cima da conversa.
  await page.setViewportSize({ width: 1000, height: 700 })
  await expect(async () => {
    const p = await panel.boundingBox()
    const s = await session.boundingBox()
    expect(p && s && p.y < s.y).toBe(true)
  }).toPass()
  await page.setViewportSize({ width: 1280, height: 800 })

  // Notificação de uma tarefa que não está mais no quadro.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('board:open-task', {
      projectId: 'proj-nav',
      taskId: 'tarefa-que-sumiu'
    })
  })
  await expect(page.getByRole('heading', { name: 'Tarefa não encontrada' })).toBeVisible()
  await page.getByRole('button', { name: 'Voltar ao quadro' }).click()
  await expect(h1(page, 'Quadro')).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('Command Palette e atalhos: Ctrl+K acha a tarefa, Ctrl+número troca de tela, teclado no quadro', async () => {
  const { page } = orkio!
  // Paleta pelo teclado: busca sem acento, Enter abre a tela da tarefa.
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Buscar tarefas e comandos' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('listar tarefas')
  await expect(palette.getByRole('option', { name: /ORK-2/ })).toBeVisible()
  await expect(palette.getByRole('option', { name: /ORK-2/ })).toContainText(
    'orkio-app · Em andamento'
  )
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()

  // Telas pela paleta e pelos atalhos; Alt+← volta.
  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await page.keyboard.type('modelos')
  await expect(palette.getByRole('option', { name: 'Modelos do alva-flow' })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Fluxos', selected: true })).toBeVisible()
  await page.keyboard.press('Control+3')
  await expect(h1(page, 'Integrações')).toBeVisible()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(h1(page, 'Quadro e automações')).toBeVisible()
  await page.keyboard.press('Control+1')
  await expect(h1(page, 'Quadro')).toBeVisible()
  await page.keyboard.press('Control+4')
  await expect(h1(page, 'Quadro')).toBeVisible()

  // Quadro pelo teclado: menu do card e Ctrl+Enter abre a tela da tarefa.
  const card = page.getByRole('listitem', { name: ORK2, exact: true })
  await card.focus()
  await page.keyboard.press('m')
  await expect(page.getByRole('menuitem', { name: 'Abrir detalhes' })).toBeVisible()
  await page.keyboard.press('Escape')
  await card.focus()
  await page.keyboard.press('Control+Enter')
  await expect(h1(page, 'Listar tarefas do Notion')).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('Buscar tarefa: o banco do Notion inteiro; fora do quadro abre no Notion; conta na lateral', async () => {
  const { app, page } = orkio!
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  // Sem GitHub, a conta é a do Notion (nome da pessoa, sem e-mail).
  await expect(nav.getByRole('button', { name: /^Conta: Ada Lovelace/ })).toBeVisible()

  await nav.getByRole('button', { name: /^Buscar tarefa/ }).click()
  const search = page.getByRole('dialog', { name: 'Buscar tarefas no Notion' })
  await expect(search).toBeVisible()
  // Tarefa de outra pessoa (não está no seu quadro) também aparece, marcada para abrir no Notion.
  await page.keyboard.type('outra pessoa')
  const other = search.getByRole('option', { name: /Tarefa de outra pessoa/ })
  await expect(other).toContainText('abre no Notion')
  await other.click()
  await expect.poll(() => openedUrls(app)).toContain('https://www.notion.so/ORK-9-bbbb9')

  // Pelo ID: a sua abre a tela da tarefa no Orkio.
  await nav.getByRole('button', { name: /^Buscar tarefa/ }).click()
  await page.keyboard.type('ORK-2')
  await search.getByRole('option', { name: /Listar tarefas do Notion/ }).click()
  await expect(h1(page, 'Listar tarefas do Notion')).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})
