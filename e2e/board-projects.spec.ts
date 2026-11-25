import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  NOTION_MAPPING,
  NOTION_TASK_IDS,
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  navTo,
  notionState,
  removeDir,
  seedConfig,
  type OrkioApp
} from './fixtures'

const TOKEN = 'ntn_E2E_BOARD_PROJECTS_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const ORK3 = 'ORK-3 Nova home do site'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const ROLE_COLUMNS = [
  'A fazer',
  'Trabalhando',
  'Em revisão',
  'Revisada',
  'Concluída',
  'Outras etapas'
]

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

function columns(page: Page): Locator {
  return page.getByRole('list', { name: 'Etapas do quadro' })
}
function column(page: Page, name: string): Locator {
  return columns(page).getByRole('listitem', { name, exact: true })
}
/** Nomes das colunas (os `listitem` de nível 1 da lista "Etapas do quadro"). */
async function columnNames(page: Page): Promise<string[]> {
  return columns(page)
    .locator(':scope > [role="listitem"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
}
function card(page: Page, label: string): Locator {
  return page.getByRole('listitem', { name: label, exact: true })
}
function projectSwitcher(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `Projeto atual: ${name}. Trocar projeto` })
}
function picker(page: Page): Locator {
  return page.getByRole('button', { name: 'Projetos do quadro' })
}
const tabNames = async (page: Page): Promise<string[]> =>
  (await page.getByRole('tablist', { name: 'Abas abertas' }).getByRole('tab').allInnerTexts()).map(
    (t) => t.replace(/\s+/g, ' ').trim()
  )
const pagePatches = async (app: OrkioApp['app']) =>
  (await externalCalls(app)).filter((c) => c.url.startsWith('https://api.notion.com/v1/pages/'))
/** Status gravado por cada PATCH de uma tarefa, na ordem. */
const patchedStatuses = async (app: OrkioApp['app'], taskId: string): Promise<string[]> =>
  (await pagePatches(app))
    .filter((p) => p.url === `https://api.notion.com/v1/pages/${taskId}`)
    .map(
      (p) =>
        (
          JSON.parse(p.body!) as {
            properties: Record<string, { status?: { name: string } }>
          }
        ).properties[NOTION_MAPPING.status.id]?.status?.name ?? '?'
    )

/**
 * Asserção negativa que precisa continuar verdadeira: a escrita no Notion é assíncrona, então
 * confere várias vezes ao longo de `ms` (um PATCH tardio derruba o teste).
 */
async function holds(check: () => Promise<void>, ms = 2_000): Promise<void> {
  const end = Date.now() + ms
  do {
    await check()
    await new Promise((r) => setTimeout(r, 200))
  } while (Date.now() < end)
  await check()
}

/**
 * Arrasta o card até a coluna pelo ponteiro (como o critério 3 de `board.spec.ts`); `during` roda
 * com o card ainda no ar, antes do `mouse.up()`.
 */
async function drag(
  page: Page,
  label: string,
  target: string,
  during?: () => Promise<void>
): Promise<void> {
  const from = await card(page, label).boundingBox()
  const to = await column(page, target).boundingBox()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + 20)
  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2 + 40, from!.y + 40, { steps: 5 })
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 80, { steps: 10 })
  if (during) await during()
  await page.mouse.up()
}

async function open(): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN] }, { startPage: 'projects' })
  // Seis colunas de 268 px lado a lado: o arraste por ponteiro precisa da origem e do destino na tela.
  await orkio.page.setViewportSize({ width: 1960, height: 800 })
  await navTo(orkio.page, 'Quadro')
  return orkio
}
async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}
async function createBoard(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(column(page, 'Prioridades')).toBeVisible()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  seedConfig(
    userDataDir,
    { id: 'proj-a', name: 'orkio-app', localPath: join(userDataDir, 'nao-existe-a'), repo: null },
    [
      {
        id: 'proj-b',
        name: 'site',
        localPath: join(userDataDir, 'nao-existe-b'),
        repo: null,
        notionProject: { id: NOTION_FAKE.sitePage, name: 'Site institucional' }
      }
    ]
  )
})

test.afterAll(async () => {
  await close()
  removeDir(userDataDir)
})

test('vários projetos: colunas pelo papel, projeto no card, arrastar no projeto certo', async () => {
  // 1. Conecta o Notion e cria o quadro dos dois projetos.
  let { app, page } = await open()
  const status = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    TOKEN
  )
  expect(status.state).toBe('connected')
  await navTo(page, 'Projetos')
  await navTo(page, 'Quadro')
  await expect(projectSwitcher(page, 'orkio-app')).toBeVisible()
  await createBoard(page)
  await expect(column(page, 'Em andamento').getByRole('listitem', { name: ORK2 })).toBeVisible()

  await projectSwitcher(page, 'orkio-app').click()
  await page.getByRole('menuitem', { name: 'site', exact: true }).click()
  await expect(projectSwitcher(page, 'site')).toBeVisible()
  await navTo(page, 'Quadro')
  await createBoard(page)
  await expect(column(page, 'Sem etapa').getByRole('listitem', { name: ORK3 })).toBeVisible()

  // 2. A etapa "Finalizada" do site fica sem papel (sem coluna "Concluída" para ele).
  await close()
  const configPath = join(userDataDir, 'orkio-config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    boards: Record<string, { stages: { name: string; role?: string }[] }>
  }
  const finalizada = config.boards['proj-b']!.stages.find((s) => s.name === 'Finalizada')!
  expect(finalizada.role).toBe('done')
  delete finalizada.role
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  ;({ app, page } = await open())

  // 3. Todos os projetos: colunas pelo papel e o projeto no card.
  await picker(page).click()
  await page.getByRole('checkbox', { name: 'Todos os projetos' }).click()
  await expect(picker(page)).toHaveText('Todos os projetos')
  await expect.poll(() => columnNames(page)).toEqual(ROLE_COLUMNS)
  await expect(
    column(page, 'Trabalhando').getByRole('listitem', { name: ORK2 }).getByTestId('card-project')
  ).toHaveText('orkio-app')
  await expect(
    column(page, 'Outras etapas').getByRole('listitem', { name: ORK3 }).getByTestId('card-stage')
  ).toHaveText('Sem etapa')
  await expect(
    column(page, 'Outras etapas').getByRole('listitem', { name: ORK3 }).getByTestId('card-project')
  ).toHaveText('site')

  // 4. O site não tem etapa "Concluída": a coluna fica bloqueada e nada muda.
  await drag(page, ORK3, 'Concluída', async () => {
    await expect(column(page, 'Concluída')).toHaveAttribute('data-drop', 'blocked')
    await expect(column(page, 'Concluída')).toHaveAttribute('aria-disabled', 'true')
    await expect(column(page, 'A fazer')).not.toHaveAttribute('data-drop', 'blocked')
  })
  await holds(async () => {
    await expect(column(page, 'Outras etapas').getByRole('listitem', { name: ORK3 })).toBeVisible()
    expect(await patchedStatuses(app, NOTION_TASK_IDS.ork3)).toEqual([])
  })
  await expect(column(page, 'Concluída')).not.toHaveAttribute('data-drop', 'blocked')

  // 5. "A fazer" = Prioridades do site → Notion "Prioridades".
  await drag(page, ORK3, 'A fazer')
  await expect(column(page, 'A fazer').getByRole('listitem', { name: ORK3 })).toBeVisible()
  await expect
    .poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork3])
    .toBe('Prioridades')

  // 6. "Concluída" = Finalizada do orkio-app → Notion "Finalizadas". O projeto atual é o site:
  // o destino sai do projeto do card, não do projeto atual.
  await expect(projectSwitcher(page, 'site')).toBeVisible()
  await drag(page, ORK2, 'Concluída')
  await expect(column(page, 'Concluída').getByRole('listitem', { name: ORK2 })).toBeVisible()
  await expect
    .poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork2])
    .toBe('Finalizadas')

  // 7. "Outras etapas" também não aceita cards.
  await drag(page, ORK2, 'Outras etapas', async () => {
    await expect(column(page, 'Outras etapas')).toHaveAttribute('data-drop', 'blocked')
  })
  // No fim, um PATCH por movimento válido e nenhum dos arrastes bloqueados (nem tardio).
  await holds(async () => {
    await expect(column(page, 'Concluída').getByRole('listitem', { name: ORK2 })).toBeVisible()
    expect(await patchedStatuses(app, NOTION_TASK_IDS.ork3)).toEqual(['Prioridades'])
    expect(await patchedStatuses(app, NOTION_TASK_IDS.ork2)).toEqual(['Finalizadas'])
    expect(await pagePatches(app)).toHaveLength(2)
  })
  expect(await cspViolations(page)).toEqual([])
})

test('filtro e visão na rota sobrevivem a reabrir; Ctrl/⌘1 mantém, Ctrl/⌘2 abre todos', async () => {
  let { page } = orkio!
  const inProgress = (p: Page): Locator =>
    p.getByRole('button', { name: 'Em andamento', exact: true })

  // "Em andamento": nenhum card (sem fluxo rodando), mas as colunas continuam.
  await inProgress(page).click()
  await expect(inProgress(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => columnNames(page)).toEqual(ROLE_COLUMNS)
  for (const name of ROLE_COLUMNS) {
    await expect(column(page, name).getByTestId('column-count')).toHaveText('0')
  }
  await expect(card(page, ORK2)).toHaveCount(0)
  await expect(card(page, ORK3)).toHaveCount(0)

  // Lista: uma seção por coluna, com a pílula do projeto.
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await page.getByRole('radio', { name: 'Lista' }).click()
  const list = page.getByTestId('board-list')
  await expect(
    list.getByRole('region', { name: 'A fazer' }).getByRole('listitem', { name: ORK3 })
  ).toContainText('site')
  await expect(
    list
      .getByRole('region', { name: 'Concluída' })
      .getByRole('listitem', { name: ORK2 })
      .getByTestId('card-project')
  ).toHaveText('orkio-app')
  await inProgress(page).click()
  await expect(inProgress(page)).toHaveAttribute('aria-pressed', 'true')

  // Reabre: a mesma aba de Quadro, com todos os projetos, Lista e "Em andamento".
  await close()
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN] }, { startPage: 'projects' })
  page = orkio.page
  await expect.poll(() => tabNames(page)).toContain('Quadro')
  await page
    .getByRole('tablist', { name: 'Abas abertas' })
    .getByRole('tab', { name: 'Quadro' })
    .click()
  const expectSaved = async (): Promise<void> => {
    await expect(picker(page)).toHaveText('Todos os projetos')
    await expect(page.getByRole('radio', { name: 'Lista' })).toBeChecked()
    await expect(inProgress(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('board-list')).toBeVisible()
  }
  await expectSaved()

  // Ctrl/⌘1 abre o Quadro como estava.
  await navTo(page, 'Configurações')
  await page.keyboard.press(`${MOD}+1`)
  await expectSaved()

  // Só o orkio-app: colunas = etapas reais e ele vira o projeto atual.
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await page.getByRole('radio', { name: 'Kanban' }).click()
  await picker(page).click()
  await page.getByRole('checkbox', { name: 'site', exact: true }).click()
  await expect(picker(page)).toHaveText('orkio-app')
  await expect
    .poll(() => columnNames(page))
    .toEqual(['Prioridades', 'Em andamento', 'Revisando', 'Revisado', 'Finalizada', 'Sem etapa'])
  await expect(card(page, ORK3)).toHaveCount(0)
  await expect(projectSwitcher(page, 'orkio-app')).toBeVisible()

  // Ctrl/⌘2 volta a "Todos os projetos" na mesma aba.
  await page.keyboard.press(`${MOD}+2`)
  await expect(picker(page)).toHaveText('Todos os projetos')
  await expect.poll(() => columnNames(page)).toEqual(ROLE_COLUMNS)
  expect((await tabNames(page)).filter((t) => t === 'Quadro')).toHaveLength(1)
  expect(await cspViolations(page)).toEqual([])
})

test('nenhum token nos logs', async () => {
  await close()
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(TOKEN)
  expect(logs).not.toMatch(/Content Security Policy/)
})
