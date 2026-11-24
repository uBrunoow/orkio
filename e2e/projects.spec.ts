import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  launchOrkio,
  openedUrls,
  queueFolderPicks,
  removeDir,
  setFakes,
  type OrkioApp,
  alerts
} from './fixtures'

const PAT = 'github_pat_E2E_PROJECTS_TOKEN_0123456789'

// Compartilham o mesmo userData e as mesmas pastas: rodam em ordem.
test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

const repoDir = (): string => join(work, 'orkio')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    .toString()
    .trim()
}

function initRepo(dir: string, remotes: Record<string, string>): void {
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'E2E')
  writeFileSync(join(dir, 'README.md'), '# e2e\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  for (const [name, url] of Object.entries(remotes)) git(dir, 'remote', 'add', name, url)
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['ORKIO_E2E_SCREENSHOTS']
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) })
}

async function open(): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, {}, { startPage: 'projects' })
  return orkio
}

async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}

function projectRow(page: Page, name: string): Locator {
  return page.getByRole('list', { name: 'Projetos' }).getByRole('listitem', { name })
}

async function pick(app: OrkioApp, folder: string): Promise<void> {
  await queueFolderPicks(app.app, [folder])
  await app.page.getByRole('button', { name: 'Adicionar projeto' }).first().click()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  // Fork: origin = cópia do usuário, upstream = original.
  initRepo(repoDir(), {
    origin: 'git@github.com:uBrunoow/orkio.git',
    upstream: 'https://github.com/acme/orkio.git'
  })
  initRepo(join(work, 'sem-remote'), {})
  initRepo(join(work, 'gitlab'), { origin: 'git://gitlab.example.org/team/app.git' })
  initRepo(join(work, 'org-restrita'), { origin: 'https://github.com/restrita-org/app.git' })
  initRepo(join(work, 'org-sso'), { origin: 'https://github.com/sso-org/app.git' })
  initRepo(join(work, 'arquivado'), { origin: 'https://github.com/uBrunoow/velho.git' })
  mkdirSync(join(work, 'pasta-comum'))
})

test.afterAll(async () => {
  await close()
  removeDir(userDataDir)
  removeDir(work)
})

test('abre em Projetos com estado vazio e dica para conectar o GitHub', async () => {
  const { page } = await open()
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nenhum projeto ainda' })).toBeVisible()
  await expect(page.getByText('Conecte sua conta do GitHub para adicionar')).toBeVisible()
  await shot(page, 'projects-1-vazio')
})

test('GitHub desconectado → erro claro ao adicionar', async () => {
  const app = orkio!
  await pick(app, repoDir())
  await app.page
    .getByRole('region', { name: 'Adicionar projeto' })
    .getByRole('button', { name: 'Adicionar projeto' })
    .click()
  await expect(alerts(app.page)).toContainText('Conecte sua conta do GitHub em Integrações')
  await app.page.getByRole('button', { name: 'Cancelar' }).click()

  // Conecta o GitHub (token; API simulada) para os próximos testes.
  const status = await app.page.evaluate(
    (token) => window.orkio.github.connect({ kind: 'token', token }),
    PAT
  )
  expect(status.state).toBe('connected')
  // A dica some ao voltar para a janela.
  await app.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(app.page.getByText('Conecte sua conta do GitHub para adicionar')).toHaveCount(0)
})

test('erros ao escolher a pasta: não é repo, sem remote, remote fora do GitHub', async () => {
  const app = orkio!
  const cases: [string, RegExp][] = [
    [join(work, 'pasta-comum'), /não é um repositório git/],
    [join(work, 'sem-remote'), /não tem remote/],
    [
      join(work, 'gitlab'),
      /Nenhum remote deste repositório aponta para o GitHub \(gitlab\.example\.org\)/
    ]
  ]
  for (const [folder, message] of cases) {
    await pick(app, folder)
    await expect(alerts(app.page)).toContainText(message)
  }
  // Cancelar o seletor não muda nada.
  await app.page.getByRole('button', { name: 'Adicionar projeto' }).first().click()
  await expect(app.page.getByRole('heading', { name: 'Nenhum projeto ainda' })).toBeVisible()
})

test('subpasta de um fork → usa a raiz, escolhe o remote e cria o projeto', async () => {
  const app = orkio!
  await pick(app, join(repoDir(), 'src', 'deep'))

  const panel = app.page.getByRole('region', { name: 'Adicionar projeto' })
  await expect(panel.getByText('Você escolheu uma subpasta')).toBeVisible()
  await expect(panel.getByText(repoDir(), { exact: true })).toBeVisible()
  await expect(panel.getByText('Parece um fork')).toBeVisible()
  await expect(panel.getByRole('radio', { name: /origin — uBrunoow\/orkio/ })).toBeChecked()
  await expect(panel.getByRole('radio', { name: /upstream — acme\/orkio/ })).toBeVisible()
  await shot(app.page, 'projects-2-adicionar')

  await panel.getByRole('button', { name: 'Adicionar projeto' }).click()
  const row = projectRow(app.page, 'orkio')
  await expect(row).toBeVisible()
  await expect(row.getByText('uBrunoow/orkio')).toBeVisible()
  await expect(row.locator('[data-testid="project-branch"]')).toHaveText('main')
  await expect(row.locator('[data-health]')).toHaveText('OK')
  await expect(panel).toHaveCount(0)

  // Config não secreta salva com schemaVersion e sem token.
  const config = readFileSync(join(userDataDir, 'orkio-config.json'), 'utf8')
  expect(JSON.parse(config)).toMatchObject({
    schemaVersion: expect.any(Number),
    notion: null,
    projects: [{ name: 'orkio', localPath: repoDir(), repo: { owner: 'uBrunoow', name: 'orkio' } }]
  })
  expect(config).not.toContain(PAT)
})

test('trocar de branch no terminal atualiza a UI em até ~2 s', async () => {
  const { page } = orkio!
  const row = projectRow(page, 'orkio')
  const started = Date.now()
  git(repoDir(), 'checkout', '-q', '-b', 'ORK-142/sync-notion')
  await expect(row.locator('[data-testid="project-branch"]')).toHaveText('ORK-142/sync-notion', {
    timeout: 2000
  })
  expect(Date.now() - started).toBeLessThan(2500)

  git(repoDir(), 'checkout', '-q', 'main')
  await expect(row.locator('[data-testid="project-branch"]')).toHaveText('main', { timeout: 2000 })
})

test('alterações não commitadas aparecem ao voltar para a janela', async () => {
  const { page } = orkio!
  const row = projectRow(page, 'orkio')
  await expect(row.getByText('alterações não commitadas')).toHaveCount(0)
  writeFileSync(join(repoDir(), 'novo.txt'), 'x')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(row.getByText('alterações não commitadas')).toBeVisible()
  await shot(page, 'projects-3-lista')
})

test('organização com restrição de OAuth Apps e com SSO → mensagem + link de acesso', async () => {
  const app = orkio!
  await setFakes(app.app, {
    githubRepos: { 'restrita-org/app': 'restricted', 'sso-org/app': 'sso' }
  })
  const panel = app.page.getByRole('region', { name: 'Adicionar projeto' })

  await pick(app, join(work, 'org-restrita'))
  await panel.getByRole('button', { name: 'Adicionar projeto' }).click()
  await expect(alerts(panel)).toContainText('Um admin da organização precisa aprovar o Orkio')
  await panel.getByRole('button', { name: /Abrir configurações de acesso do GitHub/ }).click()
  await expect
    .poll(() => openedUrls(app.app))
    .toContain('https://github.com/settings/personal-access-tokens')
  await shot(app.page, 'projects-4-org-restrita')
  await panel.getByRole('button', { name: 'Cancelar' }).click()

  await pick(app, join(work, 'org-sso'))
  await panel.getByRole('button', { name: 'Adicionar projeto' }).click()
  await expect(alerts(panel)).toContainText('usa SSO (SAML)')
  await panel.getByRole('button', { name: /Autorizar SSO da organização/ }).click()
  await expect
    .poll(() => openedUrls(app.app))
    .toContain('https://github.com/orgs/sso-org/sso?authorization_request=E2E')
  await panel.getByRole('button', { name: 'Cancelar' }).click()
})

test('repositório arquivado é salvo, com aviso', async () => {
  const app = orkio!
  await setFakes(app.app, { githubRepos: { 'ubrunoow/velho': 'archived' } })
  await pick(app, join(work, 'arquivado'))
  await app.page
    .getByRole('region', { name: 'Adicionar projeto' })
    .getByRole('button', { name: 'Adicionar projeto' })
    .click()
  const row = projectRow(app.page, 'velho')
  await expect(row.getByText('Repositório arquivado no GitHub')).toBeVisible()
  await close()
})

test('reabrir o app mantém os projetos e revalida no GitHub', async () => {
  const { page } = await open()
  await expect(projectRow(page, 'orkio').locator('[data-health]')).toHaveText('OK')
  await expect(projectRow(page, 'velho')).toBeVisible()
})

test('pasta movida → "Pasta não encontrada" → Reapontar pasta', async () => {
  const app = orkio!
  const moved = join(work, 'orkio-movido')
  renameSync(repoDir(), moved)
  await app.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const row = projectRow(app.page, 'orkio')
  await expect(row.locator('[data-health]')).toHaveText('Pasta não encontrada')
  await shot(app.page, 'projects-5-pasta-sumiu')

  // Pasta de outro repositório é recusada.
  await queueFolderPicks(app.app, [join(work, 'arquivado')])
  await row.getByRole('button', { name: 'Reapontar pasta' }).click()
  await expect(alerts(row)).toContainText('não de uBrunoow/orkio')

  await queueFolderPicks(app.app, [moved])
  await row.getByRole('button', { name: 'Reapontar pasta' }).click()
  await expect(row.locator('[data-health]')).toHaveText('OK')
  await expect(row.getByText(moved, { exact: true })).toBeVisible()
})

test('remover só tira do Orkio: a pasta continua no disco', async () => {
  const { page } = orkio!
  const row = projectRow(page, 'velho')
  await row.getByRole('button', { name: /^Mais ações de / }).click()
  await page.getByRole('menuitem', { name: 'Remover do Orkio' }).click()
  await row.getByRole('group').getByRole('button', { name: 'Remover' }).click()
  await expect(row).toHaveCount(0)
  expect(existsSync(join(work, 'arquivado', 'README.md'))).toBe(true)
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('configuração corrompida não derruba o app: backup + aviso', async () => {
  writeFileSync(join(userDataDir, 'orkio-config.json'), '{ corrompido')
  const { page } = await open()
  await expect(page.getByRole('status').filter({ hasText: 'estavam corrompidas' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nenhum projeto ainda' })).toBeVisible()
  await close()
})

test('nenhum token aparece nos logs', () => {
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(PAT)
  expect(logs).not.toMatch(/Content Security Policy/)
})
