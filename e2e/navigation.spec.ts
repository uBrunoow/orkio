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
  type OrkioApp,
  expectTaskHistory
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
          project: { id: 'rel', name: 'Projeto', type: 'relation' }
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

test('menu do projeto: cada tela tem o próprio título e o menu sempre sai das subtelas', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), TOKEN)

  // Sem quadro: as outras telas do projeto pedem para criá-lo.
  await navTo(page, 'Etapas e automações')
  await expect(page.getByRole('heading', { name: 'Crie o quadro primeiro' })).toBeVisible()
  await page.getByRole('button', { name: 'Ir para o Quadro' }).click()
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()
  await expect(page.getByTestId('page-context')).toHaveText('orkio-app')

  // Subtela de Etapas e automações; clicar no mesmo item volta ao começo da tela (G1).
  await navTo(page, 'Etapas e automações')
  await expect(h1(page, 'Etapas e automações')).toBeVisible()
  await page.getByRole('button', { name: 'Mais ações do fluxo' }).click()
  await page.getByRole('menuitem', { name: 'Etapa Orkio e Bloqueada…' }).click()
  await expect(page.getByRole('heading', { name: 'Ajustar quadro' })).toBeVisible()
  await navTo(page, 'Etapas e automações')
  await expect(page.getByRole('button', { name: 'Mais ações do fluxo' })).toBeVisible()
  // Entrega (5C) é regra do projeto: fica aqui, não em Fluxos.
  const approval = page
    .getByRole('region', { name: 'Entrega' })
    .getByRole('checkbox', { name: 'Exigir minha aprovação para push' })
  await expect(approval).toBeChecked()
  // Grava na hora (o estado vem do main depois do clique).
  await approval.click()
  await expect(approval).not.toBeChecked()
  await navTo(page, 'Etapas e automações')
  await expect(approval).not.toBeChecked()
  await approval.click()
  await expect(approval).toBeChecked()

  // Fluxos com a aba Modelos Alva; Contexto do Claude; e o Quadro de volta.
  await navTo(page, 'Fluxos')
  await expect(h1(page, 'Fluxos')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Fluxos do projeto' })).toBeVisible()
  await page.getByRole('tab', { name: 'Modelos Alva' }).click()
  await expect(page.getByRole('region', { name: 'alva-flow', exact: true })).toBeVisible()
  await navTo(page, 'Contexto do Claude')
  await expect(h1(page, 'Contexto do Claude')).toBeVisible()
  await navTo(page, 'Quadro')
  await expect(h1(page, 'Quadro')).toBeVisible()
  // Um único h1 por tela.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  expect(await cspViolations(page)).toEqual([])
})

test('tarefa: painel com rolagem própria, tela cheia e volta ao quadro com o painel aberto', async () => {
  const { page } = orkio!
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Abrir tarefa' }).click()

  await expect(h1(page, 'Listar tarefas do Notion')).toBeVisible()
  await expect(page.getByTestId('page-context')).toHaveText('ORK-2 · orkio-app')
  const task = page.getByRole('region', { name: 'Tarefa ORK-2' })
  // Tela cheia: em que pé está, a sessão (conversa + campo) e o estado ao lado.
  await expect(task.getByRole('list', { name: 'Andamento da tarefa' })).toBeVisible()
  const session = task.getByRole('region', { name: 'Sessão da tarefa' })
  await expect(session.getByRole('list', { name: 'Conversa da tarefa' })).toContainText(
    'Entrou no quadro'
  )
  await expect(session.getByRole('textbox', { name: /^Mensagem para/ })).toBeVisible()
  await expect(task.getByRole('region', { name: 'Mudanças' })).toBeVisible()
  await expectTaskHistory(task, 'Entrou no quadro')
  // O menu marca o Quadro enquanto a tarefa está aberta.
  await expect(
    page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Quadro', exact: true })
  ).toHaveAttribute('aria-current', 'page')

  await page.getByRole('button', { name: 'Voltar ao quadro' }).click()
  await expect(h1(page, 'Quadro')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Detalhes de ORK-2' })).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('Command Palette e atalhos: Ctrl+K acha a tarefa, Ctrl+número troca de tela, teclado no quadro', async () => {
  const { page } = orkio!
  // Esc fecha o painel.
  await page.getByRole('heading', { level: 1, name: 'Quadro' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Detalhes de ORK-2' })).toBeHidden()

  // Paleta pelo teclado: busca sem acento, Enter abre a tarefa no painel.
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
  await expect(page.getByRole('complementary', { name: 'Detalhes de ORK-2' })).toBeVisible()

  // Telas pela paleta e pelos atalhos; Alt+← volta.
  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await page.keyboard.type('modelos')
  await expect(palette.getByRole('option', { name: 'Modelos Alva' })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Modelos Alva', selected: true })).toBeVisible()
  await page.keyboard.press('Control+3')
  await expect(h1(page, 'Etapas e automações')).toBeVisible()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(h1(page, 'Fluxos')).toBeVisible()
  await page.keyboard.press('Control+2')
  await expect(h1(page, 'Quadro')).toBeVisible()

  // Quadro pelo teclado: foco no card, Ctrl+Enter abre em tela cheia.
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
