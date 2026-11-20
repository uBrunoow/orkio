import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  openedUrls,
  removeDir,
  setFakes,
  type OrkioApp
} from './fixtures'

const NOTION_TOKEN = 'ntn_E2E_SIGNALS_TOKEN_abcdef123456'
const GITHUB_PAT = 'github_pat_E2E_SIGNALS_TOKEN_0123456789'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []
const repoDir = (): string => join(work, 'orkio-app')

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoDir(),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
    .toString()
    .trim()
}

function taskRow(page: Page, title: string): Locator {
  return page
    .getByRole('list', { name: 'Tarefas do Notion' })
    .getByRole('listitem', { name: title })
}

const ORK1 = 'Conectar o Notion via OAuth'
const ORK2 = 'Listar tarefas do Notion'

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

  // Projeto já vinculado ao Notion (config v2 da 2C): o foco aqui é a 2D.
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
          id: 'proj-signals',
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
  if (orkio) {
    allLogs.push(...orkio.logs)
    await orkio.app.close()
  }
  removeDir(userDataDir)
  removeDir(work)
})

test('branch local e PR aparecem na tarefa certa', async () => {
  orkio = await launchOrkio(
    userDataDir,
    {
      validTokens: [NOTION_TOKEN],
      githubBranches: ['main', 'feat/ORK-2-tarefas'],
      githubPulls: [
        { number: 7, title: 'ORK-2 Listar tarefas', head: 'feat/ORK-2-tarefas', state: 'open' },
        { number: 3, title: 'Antiga', head: 'ORK-2-velha', state: 'closed', updatedDaysAgo: 60 }
      ],
      githubPrDetails: { '7': { reviewDecision: 'APPROVED', unresolved: 2, checks: 'SUCCESS' } }
    },
    { startPage: 'projects' }
  )
  const { page } = orkio
  for (const [api, token] of [
    ['notion', NOTION_TOKEN],
    ['github', GITHUB_PAT]
  ] as const) {
    const status = await page.evaluate(
      ([which, t]) => window.orkio[which].connect({ kind: 'token', token: t }),
      [api, token] as const
    )
    expect(status.state).toBe('connected')
  }
  await page.reload()
  // O reload volta à tela inicial.
  await page.getByRole('button', { name: 'Começar', exact: true }).click()

  const row = page.getByRole('listitem', { name: 'orkio-app' })
  await row.getByRole('button', { name: 'Ver tarefas' }).click()
  await expect(taskRow(page, ORK2)).toBeVisible()

  // PR aberta, aprovada, com 2 threads não resolvidas; branch só remota.
  const ork2 = taskRow(page, ORK2)
  await expect(ork2.getByTestId('task-branch')).toContainText('feat/ORK-2-tarefas')
  await expect(ork2.getByTestId('task-branch-where')).toHaveText('remota')
  await expect(ork2.getByRole('button', { name: 'Abrir a PR #7 no GitHub' })).toBeVisible()
  await expect(ork2.getByTestId('pr-state')).toHaveText('Aberta')
  await expect(ork2.getByTestId('pr-review')).toHaveText('Aprovada')
  await expect(ork2.getByTestId('pr-comments')).toHaveText('2 comentários')
  // PR fechada há 60 dias fica fora da janela de 30 dias.
  await expect(ork2.getByText('+1 PR')).toHaveCount(0)
  await expect(taskRow(page, ORK1).getByTestId('task-signals')).toHaveCount(0)

  // Cria branches locais: a certa e uma de ID parecido (ORK-12 não é ORK-1).
  git('branch', 'ORK-1/oauth')
  git('branch', 'ORK-12/outra')
  await row.getByRole('button', { name: 'Atualizar' }).click()
  const ork1 = taskRow(page, ORK1)
  await expect(ork1.getByTestId('task-branch')).toContainText('ORK-1/oauth')
  await expect(ork1.getByTestId('task-branch')).not.toContainText('ORK-12')
  await expect(ork1.getByTestId('task-branch-where')).toHaveText('local')
  await expect(page.getByText('ORK-12/outra')).toHaveCount(0)

  // Abrir a PR usa a allowlist.
  await ork2.getByRole('button', { name: 'Abrir a PR #7 no GitHub' }).click()
  await expect
    .poll(() => openedUrls(orkio!.app))
    .toContain('https://github.com/acme/orkio-app/pull/7')
})

test('ETag: atualizar sem mudanças reaproveita o cache (304)', async () => {
  const { app, page } = orkio!
  const before = (await externalCalls(app)).length
  await page
    .getByRole('listitem', { name: 'orkio-app' })
    .getByRole('button', { name: 'Atualizar' })
    .click()
  await expect
    .poll(
      async () =>
        (await externalCalls(app))
          .slice(before)
          .filter((c) => c.url.includes('/repos/acme/orkio-app/pulls?state=open')).length
    )
    .toBeGreaterThan(0)
  const pulls = (await externalCalls(app))
    .slice(before)
    .filter((c) => c.url.includes('/repos/acme/orkio-app/pulls?state=open'))
  expect(pulls.at(-1)).toMatchObject({ status: 304 })
  expect(pulls.at(-1)?.ifNoneMatch).toBeTruthy()
})

test('merge da PR reflete na atualização seguinte', async () => {
  const { app, page } = orkio!
  await setFakes(app, {
    githubPulls: [
      { number: 7, title: 'ORK-2 Listar tarefas', head: 'feat/ORK-2-tarefas', state: 'merged' }
    ]
  })
  await page
    .getByRole('listitem', { name: 'orkio-app' })
    .getByRole('button', { name: 'Atualizar' })
    .click()
  const ork2 = taskRow(page, ORK2)
  await expect(ork2.getByTestId('pr-state')).toHaveText('Mergeada')
  // Revisão/comentários não aparecem para PR mergeada (comentários pendentes podem).
  await expect(ork2.getByTestId('pr-review')).toHaveCount(0)
})

test('sem acesso ao repositório ou sem GitHub: aviso, e as tarefas continuam', async () => {
  const { app, page } = orkio!
  const row = page.getByRole('listitem', { name: 'orkio-app' })
  await setFakes(app, { githubRepos: { 'acme/orkio-app': 'not_found' } })
  await row.getByRole('button', { name: 'Atualizar' }).click()
  const warning = row.getByRole('status').filter({ hasText: 'não encontrou' })
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('último resultado conhecido')
  await expect(taskRow(page, ORK2)).toBeVisible()

  await page.evaluate(() => window.orkio.github.disconnect())
  await row.getByRole('button', { name: 'Atualizar' }).click()
  await expect(row.getByRole('status').filter({ hasText: 'Conecte o GitHub' })).toBeVisible()
  // Branch local continua.
  await expect(taskRow(page, ORK1).getByTestId('task-branch')).toContainText('ORK-1/oauth')
  expect(await cspViolations(page)).toEqual([])
})

test('nenhum token nos logs', () => {
  allLogs.push(...(orkio?.logs ?? []))
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(NOTION_TOKEN)
  expect(logs).not.toContain(GITHUB_PAT)
})
