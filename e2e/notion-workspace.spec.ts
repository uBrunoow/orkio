import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  alerts,
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  notionCard,
  openedUrls,
  removeDir,
  setFakes,
  type FakeServices,
  type OrkioApp
} from './fixtures'

const TOKEN = 'ntn_E2E_WORKSPACE_TOKEN_abcdef123456'

// Mesmo userData em todos: rodam em ordem e dependem do anterior.
test.describe.configure({ mode: 'serial' })

let userDataDir: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

const configFile = (): string => join(userDataDir, 'orkio-config.json')

function workspaceCard(page: Page): Locator {
  return page.getByRole('region', { name: 'Bancos do Notion' })
}

async function open(
  fakes: Partial<FakeServices>,
  startPage: 'projects' | 'integrations' = 'integrations'
): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN], ...fakes }, { startPage })
  return orkio
}

async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}

/**
 * Gatilho de um Selector da Astryx. O nome acessível começa pelo rótulo; o papel é `button`
 * sem valor e `combobox` com valor.
 */
function selector(scope: Locator, label: string): Locator {
  const name = new RegExp(`^${label}( |$)`)
  return scope.getByRole('combobox', { name }).or(scope.getByRole('button', { name }))
}

/** Escolhe uma opção num Selector (a lista abre numa camada fora do card). */
async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  await selector(scope, label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function goTo(page: Page, name: 'Projetos' | 'Integrações'): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name })
    .click()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  // Config v1 (antes da Etapa 2C) com um projeto: testa também a migração v1 → v2.
  writeFileSync(
    configFile(),
    JSON.stringify({
      schemaVersion: 1,
      projects: [
        {
          id: 'proj-e2e-1',
          name: 'orkio-desktop',
          localPath: join(userDataDir, 'nao-existe'),
          repo: null,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    })
  )
})

test.afterAll(async () => {
  await close()
  removeDir(userDataDir)
})

test('sem Notion conectado, o card dos bancos só orienta', async () => {
  const { page } = await open({ notionTasks: 'no_unique_id' })
  await expect(workspaceCard(page)).toContainText('Conecte o Notion acima')
  // Migração v1 → … → v4 gravada no disco.
  const saved = JSON.parse(readFileSync(configFile(), 'utf8')) as Record<string, unknown>
  expect(saved['schemaVersion']).toBe(5)
  expect(saved['notion']).toBeNull()
})

test('assistente: escolhe os bancos e bloqueia sem propriedade de ID', async () => {
  const { page } = orkio!
  await notionCard(page).getByRole('button', { name: 'Usar token' }).click()
  await notionCard(page).getByLabel('Token do Notion').fill(TOKEN)
  await notionCard(page).getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(notionCard(page).getByText('Ada Lovelace', { exact: true }).first()).toBeVisible()

  const card = workspaceCard(page)
  await choose(page, card, 'Banco de Projetos', 'Projetos')
  await card.getByRole('button', { name: 'Continuar' }).click()
  await choose(page, card, 'Banco de Tarefas', 'Tarefas')
  await card.getByRole('button', { name: 'Continuar' }).click()

  await expect(alerts(card)).toContainText('precisa de uma propriedade de ID')
  await expect(alerts(card)).toContainText('escolha o tipo “ID”')
  await expect(card.getByRole('button', { name: 'Salvar' })).toBeDisabled()
})

test('com a propriedade criada no Notion, sugere o mapeamento e salva só ids e nomes', async () => {
  const { app, page } = orkio!
  const card = workspaceCard(page)
  await setFakes(app, { notionTasks: 'ok' })
  await card.getByRole('button', { name: 'Recarregar banco' }).click()
  await expect(alerts(card)).toHaveCount(0)

  // Sugestão automática pelo nome/tipo.
  for (const [label, value] of [
    ['Título', 'Nome'],
    ['ID', 'ID'],
    ['Status', 'Status'],
    ['Projeto', 'Projeto'],
    ['Prioridade', 'Prioridade'],
    ['Responsável', 'Responsável']
  ] as const) {
    await expect(selector(card, label)).toContainText(value)
  }
  await expect(card.getByLabel('Opções de status')).toContainText('Em andamento')

  await card.getByRole('button', { name: 'Salvar' }).click()
  await expect(card.getByTestId('workspace-health')).toHaveText('OK')
  await expect(card.getByRole('list', { name: 'Configuração dos bancos do Notion' })).toContainText(
    'Tarefas'
  )

  const saved = JSON.parse(readFileSync(configFile(), 'utf8')) as {
    notion: { tasksDataSource: { id: string }; mapping: Record<string, { id: string }> }
  }
  expect(saved.notion.tasksDataSource.id).toBe(NOTION_FAKE.tasksDs)
  expect(saved.notion.mapping['status']?.id).toBe('st%3A')
  expect(Object.keys(saved.notion.mapping).sort()).toEqual(
    ['assignee', 'priority', 'project', 'status', 'title', 'uniqueId'].sort()
  )
})

test('vincula o projeto local (com sugestão pelo nome) e lista as tarefas certas', async () => {
  const { app, page } = orkio!
  await goTo(page, 'Projetos')
  const row = page.getByRole('listitem', { name: 'orkio-desktop' })
  await row.getByRole('button', { name: 'Vincular ao Notion' }).click()

  const picker = row.getByRole('group', { name: 'Vincular orkio-desktop ao Notion' })
  await expect(picker.getByText('Sugestão pelo nome: “Orkio Desktop”.')).toBeVisible()
  await expect(selector(picker, 'Projeto do Notion')).toContainText('Orkio Desktop')
  await picker.getByRole('button', { name: 'Vincular' }).click()

  await expect(row.getByTestId('notion-link')).toHaveText('Orkio Desktop')
  const tasks = row.getByRole('list', { name: 'Tarefas do Notion' })
  await expect(tasks.getByRole('listitem')).toHaveCount(2)
  await expect(tasks.getByTestId('task-id')).toHaveText(['ORK-2', 'ORK-1'])
  await expect(tasks).toContainText('Listar tarefas do Notion')
  await expect(tasks).not.toContainText('Nova home do site')
  const status = tasks.getByTestId('task-status').first()
  await expect(status).toHaveText('Em andamento')
  await expect(status).toHaveAttribute('data-color', 'blue')
  await expect(tasks.getByTestId('task-priority')).toHaveText(['Alta'])

  // ID em fonte mono.
  const font = await tasks
    .getByTestId('task-id')
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(font).toMatch(/JetBrains Mono/)

  // Consulta filtrada pela relação com a página vinculada.
  const query = (await externalCalls(app)).filter((c) =>
    c.url.endsWith(`/data_sources/${NOTION_FAKE.tasksDs}/query`)
  )
  expect(JSON.parse(query.at(-1)!.body!)).toMatchObject({
    filter: { property: 'rel', relation: { contains: NOTION_FAKE.orkioPage } }
  })

  // Cache: "Ver tarefas" de novo não chama a API; "Atualizar" chama.
  await row.getByRole('button', { name: 'Ocultar tarefas' }).click()
  await row.getByRole('button', { name: 'Ver tarefas' }).click()
  await expect(tasks.getByRole('listitem')).toHaveCount(2)
  const count = async (): Promise<number> =>
    (await externalCalls(app)).filter((c) => c.url.endsWith(`${NOTION_FAKE.tasksDs}/query`)).length
  expect(await count()).toBe(query.length)
  await row.getByRole('button', { name: 'Atualizar' }).click()
  await expect.poll(count).toBe(query.length + 1)

  await tasks.getByRole('button', { name: 'Abrir ORK-2 no Notion' }).click()
  await expect.poll(() => openedUrls(app)).toContain('https://www.notion.so/ORK-2-bbbb2')

  // O arquivo de config só guarda o vínculo (id + nome), nunca conteúdo de tarefas.
  const raw = readFileSync(configFile(), 'utf8')
  expect(raw).toContain(NOTION_FAKE.orkioPage)
  expect(raw).not.toContain('Listar tarefas')
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('propriedade renomeada no Notion → aviso claro ao reabrir', async () => {
  const { page } = await open({ notionTasks: 'renamed' })
  const card = workspaceCard(page)
  await expect(card.getByTestId('workspace-health')).toHaveText('Atenção')
  await expect(card.getByRole('status').filter({ hasText: 'renomeada' })).toContainText(
    'A propriedade Status (“Status”) foi renomeada para “Etapa”.'
  )
  await close()
})

test('propriedade apagada no Notion → erro ao reabrir e tarefas bloqueadas', async () => {
  const { page } = await open({ notionTasks: 'status_deleted' })
  const card = workspaceCard(page)
  await expect(card.getByTestId('workspace-health')).toHaveText('Revisar mapeamento')
  await expect(alerts(card)).toContainText('não existe mais nas Tarefas do Notion')

  await goTo(page, 'Projetos')
  const row = page.getByRole('listitem', { name: 'orkio-desktop' })
  await row.getByRole('button', { name: 'Ver tarefas' }).click()
  await expect(alerts(row)).toContainText('precisa ser revisto em Integrações')
  await expect(row.getByRole('list', { name: 'Tarefas do Notion' })).toHaveCount(0)
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('nenhum token aparece nos logs', () => {
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(TOKEN)
  expect(logs).not.toMatch(/Content Security Policy/)
})
