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
  type OrkioApp,
  navTo,
  expandIntegrations,
  openIntegration,
  NOTION_MAPPING
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
  await navTo(page, name)
  if (name === 'Integrações') await expandIntegrations(page)
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
  // Sem Notion, a linha dos bancos só orienta (o card abre quando o Notion conecta).
  await expect(page.getByRole('article', { name: 'Bancos e campos', exact: true })).toContainText(
    'Conecte o Notion antes'
  )
  // Migração a partir da v1 gravada no disco (a versão atual não importa aqui).
  const saved = JSON.parse(readFileSync(configFile(), 'utf8')) as Record<string, unknown>
  expect(saved['schemaVersion']).toBeGreaterThan(1)
  expect(saved['notion']).toBeNull()
})

test('assistente: escolhe os bancos e, sem propriedade de ID, só orienta', async () => {
  const { page } = orkio!
  await openIntegration(page, 'Notion')
  await notionCard(page).getByRole('button', { name: 'Usar token' }).click()
  await notionCard(page).getByLabel('Token do Notion').fill(TOKEN)
  await notionCard(page).getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Notion', exact: true })).toContainText(
    'Ada Lovelace'
  )

  await openIntegration(page, 'Bancos e campos')
  const card = workspaceCard(page)
  await choose(page, card, 'Banco de Projetos', 'Projetos')
  await card.getByRole('button', { name: 'Continuar' }).click()
  await choose(page, card, 'Banco de Tarefas', 'Tarefas')
  await card.getByRole('button', { name: 'Continuar' }).click()

  // Sem ID não bloqueia: a tarefa é a página do Notion; só explica como ter IDs.
  await expect(card.getByTestId('no-unique-id')).toContainText('não tem propriedade de ID')
  await expect(alerts(card)).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Salvar' })).toBeEnabled()
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
  // Pronto: a abertura automática passa para o próximo card pendente; reabre os bancos.
  await expect(page.getByRole('article', { name: 'Bancos e campos', exact: true })).toContainText(
    'Pronto'
  )
  await openIntegration(page, 'Bancos e campos')
  await expect(card.getByTestId('workspace-health')).toHaveText('Pronto')
  await expect(
    card.getByRole('group', { name: 'Configuração dos bancos do Notion' })
  ).toContainText('Tarefas')

  const saved = JSON.parse(readFileSync(configFile(), 'utf8')) as {
    notion: { tasksDataSource: { id: string }; mapping: Record<string, { id: string }> }
  }
  expect(saved.notion.tasksDataSource.id).toBe(NOTION_FAKE.tasksDs)
  expect(saved.notion.mapping['status']?.id).toBe(NOTION_MAPPING.status.id)
  expect(Object.keys(saved.notion.mapping).sort()).toEqual(Object.keys(NOTION_MAPPING).sort())
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
  // Projeto vinculado E responsável = pessoa logada (Ada, `u1`): a tarefa de outra pessoa
  // do mesmo projeto (ORK-9 no simulado) nunca aparece.
  expect(JSON.parse(query.at(-1)!.body!)).toMatchObject({
    filter: {
      and: [
        { property: 'rel', relation: { contains: NOTION_FAKE.orkioPage } },
        { property: 'ppl', people: { contains: 'u1' } }
      ]
    }
  })

  // Cache: "Ver tarefas" de novo não chama a API; "Atualizar" chama. (Conta a partir de agora: a
  // lista lateral também lê o quadro ao vincular.)
  const count = async (): Promise<number> =>
    (await externalCalls(app)).filter((c) => c.url.endsWith(`${NOTION_FAKE.tasksDs}/query`)).length
  // Espera o ciclo das automações que o vínculo dispara no main (também lê as tarefas) acalmar.
  let before = await count()
  for (let settled = 0; settled < 3;) {
    await new Promise((r) => setTimeout(r, 500))
    const now = await count()
    settled = now === before ? settled + 1 : 0
    before = now
  }
  await row.getByRole('button', { name: 'Ocultar tarefas' }).click()
  await row.getByRole('button', { name: 'Ver tarefas' }).click()
  await expect(tasks.getByRole('listitem')).toHaveCount(2)
  expect(await count()).toBe(before)
  await row.getByRole('button', { name: 'Atualizar' }).click()
  await expect.poll(count).toBe(before + 1)

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
  await openIntegration(page, 'Bancos e campos')
  const card = workspaceCard(page)
  await expect(card.getByTestId('workspace-health')).toHaveText('Revisar mapeamento')
  await expect(card.getByRole('status').filter({ hasText: 'renomeada' })).toContainText(
    'A propriedade Status (“Status”) foi renomeada para “Etapa”.'
  )
  await close()
})

test('propriedade apagada no Notion → erro ao reabrir e tarefas bloqueadas', async () => {
  const { page } = await open({ notionTasks: 'status_deleted' })
  await openIntegration(page, 'Bancos e campos')
  const card = workspaceCard(page)
  await expect(card.getByTestId('workspace-health')).toHaveText('Tarefas bloqueadas')
  await expect(alerts(card)).toContainText('não existe mais nas Tarefas do Notion')

  await goTo(page, 'Projetos')
  const row = page.getByRole('listitem', { name: 'orkio-desktop' })
  await row.getByRole('button', { name: 'Ver tarefas' }).click()
  await expect(alerts(row)).toContainText('precisa ser revisto')
  await expect(row.getByRole('list', { name: 'Tarefas do Notion' })).toHaveCount(0)
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('nenhum token aparece nos logs', () => {
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(TOKEN)
  expect(logs).not.toMatch(/Content Security Policy/)
})
