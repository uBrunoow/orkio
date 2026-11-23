import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  NOTION_TASK_IDS,
  alerts,
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  navTo,
  notionState,
  removeDir,
  setFakes,
  setNotionStatus,
  type FakeServices,
  type OrkioApp,
  expectTaskHistory,
  taskScreen
} from './fixtures'

const TOKEN = 'ntn_E2E_BOARD_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

function column(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Etapas do quadro' })
    .getByRole('listitem', { name, exact: true })
}
function card(page: Page, label = ORK2): Locator {
  return page.getByRole('listitem', { name: label, exact: true })
}
async function moveViaMenu(page: Page, target: string): Promise<void> {
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: `Mover para ${target}` }).click()
}
async function open(fakes: Partial<FakeServices> = {}): Promise<OrkioApp> {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [TOKEN], ...fakes },
    { startPage: 'projects' }
  )
  await orkio.page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
    .click()
  return orkio
}
async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}
const pagePatches = async (app: OrkioApp['app']) =>
  (await externalCalls(app)).filter((c) => c.url.startsWith('https://api.notion.com/v1/pages/'))

test.beforeAll(() => {
  userDataDir = createUserDataDir()
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
          id: 'proj-board',
          name: 'orkio',
          localPath: join(userDataDir, 'nao-existe'),
          repo: null,
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
})

test('critério 1: o quadro abre com as 5 etapas mapeadas para os status reais', async () => {
  const { page } = await open()
  const status = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    TOKEN
  )
  expect(status.state).toBe('connected')
  await navTo(page, 'Projetos')
  await navTo(page, 'Quadro')

  const settings = page.getByRole('region', { name: 'Criar o quadro' })
  const expected = [
    ['Prioridades', 'Prioridades'],
    ['Em andamento', 'Em andamento'],
    ['Revisando', 'Em andamento'],
    ['Revisado', 'Em andamento'],
    ['Finalizada', 'Finalizadas']
  ]
  for (const [i, [name, option]] of expected.entries()) {
    await expect(settings.getByLabel(`Nome da etapa ${i + 1}`)).toHaveValue(name!)
    await expect(
      settings.getByRole('combobox', { name: new RegExp(`^Status no Notion da etapa ${i + 1}`) })
    ).toContainText(option!)
  }
  await settings.getByRole('button', { name: 'Criar quadro' }).click()

  for (const name of ['Prioridades', 'Em andamento', 'Revisando', 'Revisado', 'Finalizada']) {
    await expect(column(page, name)).toBeVisible()
  }
  await expect(column(page, 'Em andamento').getByRole('listitem', { name: ORK2 })).toBeVisible()
  // "Concluída" não tem etapa → coluna "Sem etapa".
  await expect(column(page, 'Sem etapa')).toContainText('Conectar o Notion via OAuth')
  await expect(column(page, 'Em andamento').getByTestId('column-count')).toHaveText('1')
})

test('critério 2: mover para Revisando grava a etapa fina e mantém "Em andamento" no Notion', async () => {
  const { app, page } = orkio!
  await moveViaMenu(page, 'Revisando')
  await expect(column(page, 'Revisando').getByRole('listitem', { name: ORK2 })).toBeVisible()
  await page.waitForTimeout(300)
  expect(await pagePatches(app)).toEqual([])
  expect((await notionState(app)).status[NOTION_TASK_IDS.ork2]).toBe('Em andamento')

  // Painel lateral com o histórico.
  await card(page).click()
  const panel = taskScreen(page, 'ORK-2')
  await expectTaskHistory(panel, 'Movida de Em andamento para Revisando')
  await navTo(page, 'Quadro')
})

test('critério 3: arrastar para Finalizada muda o Notion para "Finalizadas"', async () => {
  const { app, page } = orkio!
  const from = await card(page).boundingBox()
  const to = await column(page, 'Finalizada').boundingBox()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + 20)
  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2 + 40, from!.y + 40, { steps: 5 })
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 80, { steps: 10 })
  await page.mouse.up()

  await expect(column(page, 'Finalizada').getByRole('listitem', { name: ORK2 })).toBeVisible()
  await expect
    .poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork2])
    .toBe('Finalizadas')
  const patch = (await pagePatches(app)).at(-1)!
  expect(patch.url).toBe(`https://api.notion.com/v1/pages/${NOTION_TASK_IDS.ork2}`)
  expect(JSON.parse(patch.body!)).toEqual({
    properties: { 'st%3A': { status: { name: 'Finalizadas' } } }
  })
  await expect(card(page)).toHaveAttribute('data-sync', 'synced')
})

test('Notion recusa → o card volta e a mensagem explica', async () => {
  const { app, page } = orkio!
  await setFakes(app, { notionWrites: 'reject' })
  await moveViaMenu(page, 'Prioridades')
  await expect(alerts(page)).toContainText('O Notion recusou a mudança e o card voltou')
  await expect(column(page, 'Finalizada').getByRole('listitem', { name: ORK2 })).toBeVisible()
  expect((await notionState(app)).status[NOTION_TASK_IDS.ork2]).toBe('Finalizadas')
  await setFakes(app, { notionWrites: 'ok' })
  await page.getByRole('button', { name: 'Fechar aviso' }).click()
})

test('critério 4: mudar o status direto no Notion reposiciona o card ao atualizar', async () => {
  const { app, page } = orkio!
  await setNotionStatus(app, NOTION_TASK_IDS.ork2, 'Em andamento')
  await page.getByRole('button', { name: 'Atualizar' }).click()
  await expect(column(page, 'Em andamento').getByRole('listitem', { name: ORK2 })).toBeVisible()
  await card(page).click()
  await expectTaskHistory(
    taskScreen(page, 'ORK-2'),
    'Reposicionada pelo Notion: Finalizada → Em andamento'
  )
  await navTo(page, 'Quadro')
  await expect(card(page)).toBeVisible()
})

test('critério 5: sem internet fica pendente, sobrevive a fechar o app e sincroniza depois', async () => {
  const { app, page } = orkio!
  await setFakes(app, { notionNetwork: 'down' })
  await moveViaMenu(page, 'Finalizada')
  await expect(column(page, 'Finalizada').getByRole('listitem', { name: ORK2 })).toBeVisible()
  await expect(card(page)).toHaveAttribute('data-sync', 'pending')
  await expect(card(page).getByTestId('card-sync')).toHaveText('Sincronizando')
  expect(await cspViolations(page)).toEqual([])
  await close()

  // Reabre com a rede de volta: a fila retoma e escreve no Notion.
  const reopened = await open({ notionNetwork: 'up' })
  await expect
    .poll(async () => (await notionState(reopened.app)).status[NOTION_TASK_IDS.ork2], {
      timeout: 15_000
    })
    .toBe('Finalizadas')
  await expect(
    column(reopened.page, 'Finalizada').getByRole('listitem', { name: ORK2 })
  ).toBeVisible()
  await expect(card(reopened.page)).toHaveAttribute('data-sync', 'synced', { timeout: 15_000 })
  expect(await cspViolations(reopened.page)).toEqual([])
})

test('bloqueada: marca no card e filtra', async () => {
  const { page } = orkio!
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: 'Marcar como bloqueada' }).click()
  await expect(card(page).getByTestId('card-blocked')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Só bloqueadas' }).check()
  await expect(page.getByRole('listitem', { name: /Conectar o Notion/ })).toHaveCount(0)
  await expect(card(page)).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('nenhum token nos logs', async () => {
  await close()
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(TOKEN)
  expect(logs).not.toMatch(/Content Security Policy/)
})
