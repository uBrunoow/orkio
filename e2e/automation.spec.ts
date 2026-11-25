import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_TASK_IDS,
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  navTo,
  notionState,
  removeDir,
  setFakes,
  setNotionStatus,
  type FakePull,
  type FakeServices,
  type OrkioApp,
  taskTab,
  taskScreen,
  FAKE_REPO,
  seedConfig
} from './fixtures'

const NOTION_TOKEN = 'ntn_E2E_AUTOMATION_TOKEN_abcdef123456'
const GITHUB_PAT = 'github_pat_E2E_AUTOMATION_TOKEN_0123456789'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []
const repoDir = (): string => join(work, 'orkio-app')

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repoDir(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}
function column(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Etapas do quadro' })
    .getByRole('listitem', { name, exact: true })
}
function card(page: Page): Locator {
  return page.getByRole('listitem', { name: ORK2, exact: true })
}
async function expectIn(page: Page, stage: string, timeout = 10_000): Promise<void> {
  await expect(column(page, stage).getByRole('listitem', { name: ORK2, exact: true })).toBeVisible({
    timeout
  })
}
async function refresh(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Atualizar' }).click()
}
const pr = (over: Partial<FakePull> = {}): FakePull => ({
  number: 7,
  title: 'ORK-2 Listar tarefas',
  head: 'ORK-2/listar',
  state: 'open',
  updatedAt: '2026-11-19T10:00:00Z',
  ...over
})

async function open(fakes: Partial<FakeServices> = {}): Promise<OrkioApp> {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN], githubBranches: ['main'], ...fakes },
    { startPage: 'projects' }
  )
  return orkio
}
async function goToBoard(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
    .click()
}
async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}
async function historyText(page: Page): Promise<string> {
  await card(page).click()
  const panel = taskScreen(page, 'ORK-2')
  // Histórico completo (aba Detalhes): todos os eventos, mesmo os que a sessão resume.
  const details = await taskTab(panel, 'Detalhes')
  const list = details.getByRole('list', { name: 'Histórico da tarefa' })
  if (!(await list.isVisible())) await details.getByText('Histórico completo').click()
  await expect(list).toBeVisible()
  // Evento por evento, com quem fez; sem o horário relativo ("há 13 segundos"), que muda sozinho.
  const text = await list.evaluate((el) =>
    [...el.querySelectorAll('li')]
      .map((li) => {
        const copy = li.cloneNode(true) as HTMLElement
        copy.querySelectorAll('time').forEach((t) => t.remove())
        return copy.textContent ?? ''
      })
      .join('\n')
  )
  expect(text).not.toMatch(/agora|há \d/)
  await navTo(page, 'Quadro')
  return text
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('remote', 'add', 'origin', 'https://github.com/acme/orkio-app.git')
  seedConfig(userDataDir, {
    id: 'proj-auto',
    name: 'orkio-app',
    localPath: repoDir(),
    repo: FAKE_REPO
  })
})

test.afterAll(async () => {
  await close()
  removeDir(userDataDir)
  removeDir(work)
})

test('prepara: Notion + GitHub conectados e quadro criado (linha de base)', async () => {
  const { app, page } = await open()
  for (const [api, token] of [
    ['notion', NOTION_TOKEN],
    ['github', GITHUB_PAT]
  ] as const) {
    const s = await page.evaluate(
      ([w, t]) => window.orkio[w].connect({ kind: 'token', token: t }),
      [api, token] as const
    )
    expect(s.state).toBe('connected')
  }
  await setNotionStatus(app, NOTION_TASK_IDS.ork2, 'Prioridades')
  await goToBoard(page)
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expectIn(page, 'Prioridades')
  // Primeiro ciclo = linha de base (nada se move).
  await refresh(page)
  await expect(page.getByTestId('automation-status')).toContainText('GitHub verificado')
  await expectIn(page, 'Prioridades')
})

test('critério 1: criar a branch ORK-2 move para Em andamento em segundos (sem clicar)', async () => {
  const { app, page } = orkio!
  git('checkout', '-q', '-b', 'ORK-2/listar')
  await expectIn(page, 'Em andamento', 15_000)
  await expect
    .poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork2])
    .toBe('Em andamento')
})

test('critério 2: PR aberta → Revisando; alterações pedidas → Revisado; novo pedido → Revisando', async () => {
  const { app, page } = orkio!
  await setFakes(app, {
    githubPulls: [pr()],
    githubPrDetails: { '7': { reviewDecision: null, unresolved: 0, checks: null } }
  })
  await refresh(page)
  await expectIn(page, 'Revisando')

  await setFakes(app, {
    githubPulls: [pr({ updatedAt: '2026-11-19T11:00:00Z' })],
    githubPrDetails: {
      '7': {
        reviewDecision: 'CHANGES_REQUESTED',
        // Sem threads aqui: prova o caminho "alterações pedidas" sozinho.
        unresolved: 0,
        checks: null,
        reviews: [{ id: 'rv-1', state: 'CHANGES_REQUESTED', submittedAt: '2099-01-01T11:00:00Z' }]
      }
    }
  })
  await refresh(page)
  await expectIn(page, 'Revisado')

  await setFakes(app, {
    githubPulls: [pr({ updatedAt: '2026-11-19T12:00:00Z' })],
    githubPrDetails: {
      '7': {
        reviewDecision: 'REVIEW_REQUIRED',
        unresolved: 0,
        checks: null,
        reviews: [{ id: 'rv-1', state: 'CHANGES_REQUESTED', submittedAt: '2099-01-01T11:00:00Z' }],
        reviewRequests: [{ id: 'rr-2', createdAt: '2099-01-01T12:00:00Z' }]
      }
    }
  })
  await refresh(page)
  await expectIn(page, 'Revisando')
  // Mover para Revisando/Revisado não muda o status no Notion.
  expect((await notionState(app)).status[NOTION_TASK_IDS.ork2]).toBe('Em andamento')
})

test('critério 3: merge move para Finalizada e o Notion fica "Finalizadas"', async () => {
  const { app, page } = orkio!
  await setFakes(app, { githubPulls: [pr({ state: 'merged', updatedAt: '2026-11-19T13:00:00Z' })] })
  await refresh(page)
  await expectIn(page, 'Finalizada')
  await expect
    .poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork2])
    .toBe('Finalizadas')
  const text = await historyText(page)
  for (const expected of [
    'Branch criada (ORK-2/listar)',
    'PR aberta (PR #7)',
    'Alterações pedidas na review (PR #7) → regra “Alterações pedidas: revisado”: Revisando → Revisado',
    'Review pedida (PR #7) → regra “Novo pedido de review volta para revisão”: Revisado → Revisando',
    'Review pedida (PR #7)',
    'PR mergeada (PR #7)'
  ]) {
    expect(text).toContain(expected)
  }
  await card(page).click()
  const panel = taskScreen(page, 'ORK-2')
  await panel.getByRole('button', { name: 'Abrir a PR #7 no GitHub' }).first().click()
  await navTo(page, 'Quadro')
  expect(await cspViolations(page)).toEqual([])
})

test('automação em frase: começa, faz e as execuções vindas da atividade', async () => {
  const { page } = orkio!
  await navTo(page, 'Quadro e automações')
  await page
    .getByRole('list', { name: 'Etapas do fluxo' })
    .getByRole('listitem', { name: 'Etapa Finalizada' })
    .click()
  await page
    .getByRole('list', { name: 'Automações para Finalizada' })
    .getByRole('listitem', { name: 'Merge finaliza a tarefa' })
    .click()
  const detail = page.getByRole('region', { name: 'Automação Merge finaliza a tarefa' })
  await expect(detail.getByTestId('detail-sentence')).toContainText('mover para Finalizada')
  await expect(detail.getByRole('group', { name: 'Faz' })).toContainText(
    'Move a tarefa para Finalizada'
  )
  const runs = detail.getByTestId('executions')
  await expect(runs).toContainText('ORK-2')
  await expect(runs).toContainText('Moveu a tarefa')
  await expect(detail.getByTestId('detail-column')).toContainText('Ativa')
  // "Editar" abre o formulário de sempre.
  await detail.getByRole('button', { name: 'Editar' }).click()
  await expect(page.getByRole('region', { name: 'Editar automação' })).toBeVisible()
  // A coluna abre num modal: fecha antes de sair.
  await page.keyboard.press('Escape')
  await goToBoard(page)
})

test('critério 4: reiniciar o app não repete automações', async () => {
  const before = await historyText(orkio!.page)
  const finalState = { githubPulls: [pr({ state: 'merged', updatedAt: '2026-11-19T13:00:00Z' })] }
  await close()
  const { app, page } = await open({
    ...finalState,
    // O Notion de verdade continua com o que o Orkio escreveu.
    notionInitialStatus: { [NOTION_TASK_IDS.ork2]: 'Finalizadas' }
  })
  await goToBoard(page)
  await expectIn(page, 'Finalizada')
  await refresh(page)
  await refresh(page)
  await expectIn(page, 'Finalizada')
  expect(await historyText(page)).toBe(before)
  const patches = (await externalCalls(app)).filter((c) =>
    c.url.startsWith('https://api.notion.com/v1/pages/')
  )
  expect(patches).toEqual([])
})

test('critério 5: pausar impede movimentos e registra no histórico', async () => {
  const { app, page } = orkio!
  await setNotionStatus(app, NOTION_TASK_IDS.ork2, 'Prioridades')
  await refresh(page)
  await expectIn(page, 'Prioridades')
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: 'Pausar automações' }).click()
  await expect(card(page).getByTestId('card-automation-paused')).toBeVisible()

  git('checkout', '-q', '-b', 'feat/ORK-2-outra')
  await refresh(page)
  // Sinal de que o ciclo já tratou o evento (consumido como "ignorada" na mesma transação em que
  // moveria): só depois dele a ausência do movimento prova alguma coisa.
  await expect
    .poll(() => historyText(page), { timeout: 15_000 })
    .toContain(
      'Branch criada (feat/ORK-2-outra): regra “Branch criada inicia a tarefa” ignorada (automações pausadas nesta tarefa)'
    )
  await expectIn(page, 'Prioridades')

  // "Pausar todas" fica no menu ⋯ da barra do quadro.
  await page.getByRole('button', { name: 'Mais ações do quadro' }).click()
  await page.getByRole('menuitem', { name: 'Pausar todas' }).click()
  await expect(page.getByTestId('automation-status')).toContainText('pausadas para todos')
  await page.getByRole('button', { name: 'Mais ações do quadro' }).click()
  await page.getByRole('menuitem', { name: 'Retomar automações' }).click()
  expect(await cspViolations(page)).toEqual([])
})

test('GraphQL recusado: o Quadro avisa e a PR continua com o estado da REST', async () => {
  await close()
  const { page } = await open({
    githubPulls: [pr({ state: 'open', updatedAt: '2026-11-19T14:00:00Z' })],
    githubPrDetails: { '7': { reviewDecision: null, unresolved: 1, checks: null } },
    githubGraphql: 'no_scope',
    notionInitialStatus: { [NOTION_TASK_IDS.ork2]: 'Finalizadas' }
  })
  await goToBoard(page)
  await refresh(page)
  await expect(
    page.getByRole('status').filter({ hasText: 'não tem permissão para ler parte dos detalhes' })
  ).toBeVisible({ timeout: 15_000 })
  // Sem o GraphQL, os comentários da PR são desconhecidos: fica o estado da REST.
  await expect(card(page).getByRole('button', { name: 'Abrir a PR #7 no GitHub' })).toContainText(
    '#7 · Esperando review'
  )
  expect(await cspViolations(page)).toEqual([])
})

test('nenhum token nos logs', async () => {
  await close()
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(NOTION_TOKEN)
  expect(logs).not.toContain(GITHUB_PAT)
  expect(logs).not.toMatch(/Content Security Policy/)
})
