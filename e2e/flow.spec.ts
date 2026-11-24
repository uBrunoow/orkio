import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  enterApp,
  cspViolations,
  launchOrkio,
  queueFolderPicks,
  queueSavePaths,
  removeDir,
  type OrkioApp,
  navTo,
  boardSettingsTab,
  seedConfig
} from './fixtures'

const TOKEN = 'ntn_E2E_FLOW_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let orkio: OrkioApp | null = null

function boardColumn(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Etapas do quadro' })
    .getByRole('listitem', { name, exact: true })
}
function flowStage(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Etapas do fluxo' })
    .getByRole('listitem', { name: `Etapa ${name}`, exact: true })
}
/** Escolhe a etapa na lista e devolve o editor dela. */
async function openStage(page: Page, name: string): Promise<Locator> {
  await flowStage(page, name).click()
  const editor = page.getByRole('region', { name: `Etapa ${name}`, exact: true })
  await expect(editor).toBeVisible()
  return editor
}
async function flowMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Mais ações do fluxo' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}
/** Selector da Astryx: gatilho com nome começando pelo rótulo (button sem valor, combobox com valor). */
async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const name = new RegExp(`^${label}( |$)`)
  await scope
    .getByRole('combobox', { name })
    .or(scope.getByRole('button', { name }))
    .first()
    .click()
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Opções com descrição: o nome acessível começa pelo rótulo.
  await page
    .getByRole('option', { name: new RegExp(`^${escaped}( |$)`) })
    .first()
    .click()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  seedConfig(userDataDir, {
    id: 'proj-flow',
    name: 'orkio',
    localPath: join(userDataDir, 'nao-existe'),
    repo: null
  })
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
})

test('cria a etapa QA com uma regra, simula, salva e o quadro mostra a coluna nova', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), TOKEN)
  await page.reload()
  // O reload volta à abertura: Começar (sem projetos) ou Visão geral.
  await enterApp(page)
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
    .click()
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()

  // ORK-2 em Revisando (para a simulação).
  await page
    .getByRole('listitem', { name: ORK2, exact: true })
    .getByRole('button', { name: 'Ações de ORK-2' })
    .click()
  await page.getByRole('menuitem', { name: 'Mover para Revisando' }).click()
  await expect(boardColumn(page, 'Revisando').getByRole('listitem', { name: ORK2 })).toBeVisible()

  await navTo(page, 'Etapas e automações')
  await expect(page.getByRole('heading', { level: 1, name: 'Quadro e automações' })).toBeVisible()

  // Nova etapa depois de Revisado.
  const revisado = await openStage(page, 'Revisado')
  await revisado.getByRole('button', { name: 'Adicionar etapa depois de Revisado' }).click()
  const fresh = page.getByRole('region', { name: 'Etapa etapa 5', exact: true })
  await fresh.getByLabel('Nome', { exact: true }).fill('QA')
  const qa = page.getByRole('region', { name: 'Etapa QA', exact: true })
  await choose(page, qa, 'Status no Notion', 'Em andamento')
  await expect(page.getByTestId('unsaved-changes')).toHaveText('1 alteração não salva')

  // Regra: PR aprovada em Revisando → QA.
  await qa.getByRole('button', { name: 'Nova automação para QA' }).click()
  const form = page.getByRole('region', { name: 'Nova automação' })
  await choose(page, form, 'Quando', 'PR aprovada')
  await form
    .getByRole('group', { name: 'Só quando a tarefa está em' })
    .getByRole('checkbox', { name: 'Revisando' })
    .check()
  await expect(form.getByTestId('rule-preview')).toHaveText(
    'Quando a PR é aprovada e a tarefa está em Revisando, mover para QA. Ignora bloqueadas.'
  )
  await form.getByRole('button', { name: 'Aplicar ao rascunho' }).click()
  await expect(qa.getByRole('list', { name: 'Automações para QA' })).toContainText(
    'Quando a PR é aprovada e a tarefa está em Revisando, mover para QA.'
  )

  // Conflito avisado antes de salvar: outra regra para o mesmo gatilho/origem.
  const fin = await openStage(page, 'Finalizada')
  await fin.getByRole('button', { name: 'Nova automação para Finalizada' }).click()
  const form2 = page.getByRole('region', { name: 'Nova automação' })
  await choose(page, form2, 'Quando', 'PR aprovada')
  await form2
    .getByRole('group', { name: 'Só quando a tarefa está em' })
    .getByRole('checkbox', { name: 'Revisando' })
    .check()
  await form2.getByRole('button', { name: 'Aplicar ao rascunho' }).click()
  const validation = page.getByRole('region', { name: 'Validação do fluxo' })
  await expect(validation).toContainText(
    'Conflito: quando a PR é aprovada em Revisando, a regra 9ª (→ QA) vence a 10ª (→ Finalizada) pela ordem.'
  )
  await expect(validation.getByRole('button', { name: 'Salvar fluxo' })).toBeDisabled()
  // Remove a regra conflitante.
  await fin.getByRole('button', { name: 'Ações da automação PR aprovada' }).click()
  await page.getByRole('menuitem', { name: 'Remover' }).click()
  await expect(validation).not.toContainText('Conflito')

  // Simular (sem executar): fica na aba Automações.
  await boardSettingsTab(page, 'Automações')
  const sim = page.getByRole('region', { name: 'Testar automação' })
  await choose(page, sim, 'Tarefa', 'ORK-2 Listar tarefas do Notion')
  await choose(page, sim, 'Evento', 'PR aprovada')
  await sim.getByRole('button', { name: 'Testar' }).click()
  await expect(sim.getByTestId('simulation-result')).toHaveText(
    'Casa a regra “PR aprovada”: Revisando → QA. O status no Notion não muda.'
  )

  // Salvar e ver o quadro.
  await validation.getByRole('button', { name: 'Salvar fluxo' }).click()
  await expect(page.getByTestId('unsaved-changes')).toHaveText('Nenhuma alteração')
  await navTo(page, 'Quadro')
  await expect(boardColumn(page, 'QA')).toBeVisible()
  const names = await page
    .getByRole('list', { name: 'Etapas do quadro' })
    .locator(':scope > [role="listitem"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names.slice(0, 6)).toEqual([
    'Prioridades',
    'Em andamento',
    'Revisando',
    'Revisado',
    'QA',
    'Finalizada'
  ])
  // A simulação não moveu nada.
  await expect(boardColumn(page, 'Revisando').getByRole('listitem', { name: ORK2 })).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})

test('histórico de alterações e exportar/importar JSON', async () => {
  const { app, page } = orkio!
  await navTo(page, 'Etapas e automações')
  const history = page.getByRole('region', { name: 'Alterações do fluxo' })
  await expect(history).toContainText(
    'Etapa “QA” criada entre Revisado e Finalizada (Notion: Em andamento)'
  )
  await expect(history).toContainText('Quadro criado com 5 etapas')

  const file = join(userDataDir, 'fluxo.json')
  await queueSavePaths(app, [file])
  await flowMenu(page, 'Exportar JSON')
  await expect(page.getByText('Fluxo exportado.')).toBeVisible()
  const exported = JSON.parse(readFileSync(file, 'utf8')) as {
    format: string
    version: number
    stages: { name: string; notionStatus: string }[]
  }
  expect(exported.format).toBe('orkio-flow')
  expect(exported.version).toBe(1)
  expect(exported.stages.map((s) => s.name)).toContain('QA')

  // Versão futura é recusada com mensagem clara.
  const future = join(userDataDir, 'futuro.json')
  writeFileSync(future, JSON.stringify({ ...exported, version: 9 }))
  await queueFolderPicks(app, [future])
  await flowMenu(page, 'Importar JSON')
  await expect(page.getByRole('alert').filter({ hasText: 'versão mais nova' })).toBeVisible()

  // Importa o exportado: vira rascunho (precisa salvar).
  await queueFolderPicks(app, [file])
  await flowMenu(page, 'Importar JSON')
  await expect(page.getByText(/Fluxo importado no rascunho/)).toBeVisible()
  await expect(flowStage(page, 'QA')).toBeVisible()
  await page.getByRole('button', { name: 'Descartar alterações' }).click()
  await navTo(page, 'Quadro')
  await expect(boardColumn(page, 'QA')).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})
