import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  FAKE_REPO,
  NOTION_FAKE,
  NOTION_TASK_IDS,
  createUserDataDir,
  cspViolations,
  launchOrkio,
  navTo,
  notionState,
  openIntegration,
  removeDir,
  seedConfig,
  setFakes,
  setNotionStatus,
  type FakePull,
  type OrkioApp
} from './fixtures'

const NOTION_TOKEN = 'ntn_E2E_GIT_FLOW_TOKEN_abcdef123456'
const GITHUB_PAT = 'github_pat_E2E_GIT_FLOW_TOKEN_0123456789'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const ORK3 = 'ORK-3 Nova home do site'
const PR5_URL = 'https://github.com/acme/orkio-app/pull/5'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

function initRepo(dir: string, remote: string): void {
  mkdirSync(dir)
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(dir, 'README.md'), '# e2e\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('remote', 'add', 'origin', remote)
}

function column(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Etapas do quadro' })
    .getByRole('listitem', { name, exact: true })
}
function projectSwitcher(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `Projeto atual: ${name}. Trocar projeto` })
}
async function createBoard(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(column(page, 'Prioridades')).toBeVisible()
}
async function refresh(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Atualizar' }).click()
}
const pr5 = (over: Partial<FakePull> = {}): FakePull => ({
  number: 5,
  title: 'ORK-2 Listar tarefas',
  head: 'ORK-2/listar',
  base: 'dev',
  state: 'open',
  updatedAt: '2026-11-19T10:00:00Z',
  ...over
})
/** Hotfix da ORK-3 direto para a main: não mexe na Etapa Git. */
const pr6: FakePull = {
  number: 6,
  title: 'ORK-3 Nova home',
  head: 'ORK-3/home',
  base: 'main',
  state: 'open',
  updatedAt: '2026-11-19T10:00:00Z'
}
const gitOf = async (app: OrkioApp['app'], pageId: string) =>
  (await notionState(app)).git[pageId] ?? {}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  initRepo(join(work, 'orkio-app'), 'https://github.com/acme/orkio-app.git')
  initRepo(join(work, 'site'), 'https://github.com/acme/site.git')
  seedConfig(
    userDataDir,
    { id: 'proj-app', name: 'orkio-app', localPath: join(work, 'orkio-app'), repo: FAKE_REPO },
    [
      {
        id: 'proj-site',
        name: 'site',
        localPath: join(work, 'site'),
        repo: { ...FAKE_REPO, name: 'site' },
        notionProject: { id: NOTION_FAKE.sitePage, name: 'Site institucional' }
      }
    ]
  )
})

test.afterAll(async () => {
  if (orkio) {
    allLogs.push(...orkio.logs)
    await orkio.app.close()
  }
  removeDir(userDataDir)
  removeDir(work)
  const joined = allLogs.join('\n')
  for (const secret of [NOTION_TOKEN, GITHUB_PAT]) expect(joined).not.toContain(secret)
})

test('Fluxo Git: configura pela tela e a Etapa Git segue a PR até o merge na dev', async () => {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN], githubBranches: ['main'] },
    { startPage: 'projects' }
  )
  const { app, page } = orkio
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

  // ORK-3 em andamento: a PR #6 aberta a move para Revisando (prova de que o ciclo a viu).
  await setNotionStatus(app, NOTION_TASK_IDS.ork3, 'Em andamento')

  // 1. Quadro dos dois projetos (o Fluxo Git só observa projetos com quadro e vínculo).
  await navTo(page, 'Projetos')
  await navTo(page, 'Quadro')
  await expect(projectSwitcher(page, 'orkio-app')).toBeVisible()
  await createBoard(page)
  await projectSwitcher(page, 'orkio-app').click()
  await page.getByRole('menuitem', { name: 'site', exact: true }).click()
  await navTo(page, 'Quadro')
  await createBoard(page)
  await expect(
    column(page, 'Em andamento').getByRole('listitem', { name: ORK3, exact: true })
  ).toBeVisible()
  await refresh(page)

  // 2. Fluxo Git pela tela: a sugestão vem pronta (Etapa Git, as quatro opções, PR e data).
  await navTo(page, 'Integrações')
  await openIntegration(page, 'Bancos e campos')
  const section = page.getByRole('region', { name: 'Fluxo Git (opcional)' })
  await section.getByRole('button', { name: 'Configurar Fluxo Git' }).click()
  await expect(section.getByRole('combobox', { name: /^Propriedade da Etapa Git/ })).toContainText(
    'Etapa Git'
  )
  for (const [label, option] of [
    ['Branch criada', 'Branch criada'],
    ['PR aguardando review', 'PR aguardando review'],
    ['Ajustes solicitados', 'Ajustes solicitados'],
    ['Mergeada na dev', 'Mergeada na dev'],
    ['Link da PR', 'PR'],
    ['Data do merge na dev', 'Merge na dev']
  ] as const) {
    await expect(section.getByRole('combobox', { name: new RegExp(`^${label}`) })).toContainText(
      option
    )
  }
  await expect(section).toContainText('PR para main aberta e Em produção continuam no Notion')
  await section.getByRole('button', { name: 'Salvar Fluxo Git' }).click()
  await expect(section.getByRole('button', { name: 'Revisar Fluxo Git' })).toBeVisible()
  await expect(section.getByLabel('Configuração do Fluxo Git')).toContainText('Mergeada na dev')
  const saved = JSON.parse(readFileSync(join(userDataDir, 'orkio-config.json'), 'utf8')) as {
    notion: { gitFlow?: { stage: { id: string }; prUrl?: { id: string } } }
  }
  expect(saved.notion.gitFlow?.stage.id).toBe('git')
  expect(saved.notion.gitFlow?.prUrl?.id).toBe('prl')

  await navTo(page, 'Quadro')
  await projectSwitcher(page, 'site').click()
  await page.getByRole('menuitem', { name: 'orkio-app', exact: true }).click()
  await navTo(page, 'Quadro')
  await refresh(page)

  // 3. PR #5 (ORK-2 → dev) aberta: "PR aguardando review" + link da PR. PR #6 (ORK-3 → main).
  await setFakes(app, {
    githubBranches: ['main', 'ORK-2/listar'],
    githubPulls: [pr5(), pr6],
    githubPrDetails: {
      '5': { reviewDecision: null, unresolved: 0, checks: null },
      '6': { reviewDecision: null, unresolved: 0, checks: null }
    }
  })
  await refresh(page)
  await expect
    .poll(async () => (await gitOf(app, NOTION_TASK_IDS.ork2)).stage, { timeout: 15_000 })
    .toBe('PR aguardando review')
  expect((await gitOf(app, NOTION_TASK_IDS.ork2)).prUrl).toBe(PR5_URL)

  // 4. Alterações pedidas → "Ajustes solicitados".
  await setFakes(app, {
    githubPulls: [pr5({ updatedAt: '2026-11-19T11:00:00Z' }), pr6],
    githubPrDetails: {
      '5': {
        reviewDecision: 'CHANGES_REQUESTED',
        unresolved: 0,
        checks: null,
        reviews: [{ id: 'rv-1', state: 'CHANGES_REQUESTED', submittedAt: '2099-01-01T11:00:00Z' }]
      },
      '6': { reviewDecision: null, unresolved: 0, checks: null }
    }
  })
  await refresh(page)
  await expect
    .poll(async () => (await gitOf(app, NOTION_TASK_IDS.ork2)).stage, { timeout: 15_000 })
    .toBe('Ajustes solicitados')

  // 5. Review pedida de novo → volta a "PR aguardando review".
  await setFakes(app, {
    githubPulls: [pr5({ updatedAt: '2026-11-19T12:00:00Z' }), pr6],
    githubPrDetails: {
      '5': {
        reviewDecision: 'REVIEW_REQUIRED',
        unresolved: 0,
        checks: null,
        reviews: [{ id: 'rv-1', state: 'CHANGES_REQUESTED', submittedAt: '2099-01-01T11:00:00Z' }],
        reviewRequests: [{ id: 'rr-2', createdAt: '2099-01-01T12:00:00Z' }]
      },
      '6': { reviewDecision: null, unresolved: 0, checks: null }
    }
  })
  await refresh(page)
  await expect
    .poll(async () => (await gitOf(app, NOTION_TASK_IDS.ork2)).stage, { timeout: 15_000 })
    .toBe('PR aguardando review')

  // 6. Mergeada → "Mergeada na dev" com a data do merge do GitHub (`closed_at` simulado).
  await setFakes(app, {
    githubPulls: [pr5({ state: 'merged', updatedAt: '2026-11-19T13:00:00Z' }), pr6]
  })
  await refresh(page)
  await expect
    .poll(async () => (await gitOf(app, NOTION_TASK_IDS.ork2)).stage, { timeout: 15_000 })
    .toBe('Mergeada na dev')
  const merged = await gitOf(app, NOTION_TASK_IDS.ork2)
  expect(Date.parse(merged.mergedAt ?? '')).toBe(Date.parse('2026-01-01T00:00:00Z'))
  expect(merged.prUrl).toBe(PR5_URL)

  // 7. O selo da etapa (valor relido do Notion) aparece no card da ORK-2.
  const card = page.getByRole('listitem', { name: ORK2, exact: true })
  await expect
    .poll(
      async () => {
        await refresh(page)
        return (await card.getByTestId('git-stage').textContent()) ?? ''
      },
      { timeout: 15_000 }
    )
    .toContain('Mergeada na dev')

  // 7b. O mesmo selo na visão Lista.
  await page.getByRole('radio', { name: 'Lista' }).click()
  await expect(
    page
      .getByTestId('board-list')
      .getByRole('listitem', { name: ORK2, exact: true })
      .getByTestId('git-stage')
  ).toContainText('Mergeada na dev')
  await page.getByRole('radio', { name: 'Kanban' }).click()

  // 8. A PR #6 (ORK-3 → main) foi vista pelo ciclo do site (a regra a levou para Revisando, com o
  // #6 no card), mas nunca escreveu a Etapa Git da ORK-3.
  await projectSwitcher(page, 'orkio-app').click()
  await page.getByRole('menuitem', { name: 'site', exact: true }).click()
  await navTo(page, 'Quadro')
  const ork3 = column(page, 'Revisando').getByRole('listitem', { name: ORK3, exact: true })
  await expect
    .poll(
      async () => {
        await refresh(page)
        return ork3.count()
      },
      { timeout: 15_000 }
    )
    .toBe(1)
  await expect(ork3.getByRole('button', { name: 'Abrir a PR #6 no GitHub' })).toBeVisible()
  const writes = (await notionState(app)).writes
  expect(writes.some((w) => w.pageId === NOTION_TASK_IDS.ork2 && 'git' in w.properties)).toBe(true)
  expect(writes.filter((w) => w.pageId === NOTION_TASK_IDS.ork3 && 'git' in w.properties)).toEqual(
    []
  )

  expect(await cspViolations(page)).toEqual([])
})
