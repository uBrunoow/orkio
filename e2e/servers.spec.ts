import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  expectTaskHistory,
  FAKE_REPO,
  launchOrkio,
  navTo,
  openedUrls,
  openSettings,
  removeDir,
  seedConfig,
  taskScreen,
  taskTab,
  type OrkioApp
} from './fixtures'

/**
 * Servidores da tarefa: cadastro em Configurações › Servidores, subir pelo painel Ambiente da
 * tarefa (processo de verdade no worktree, porta própria em PORT), estado "Rodando" quando a porta
 * responde, abrir a URL pelo main, log só leitura com o segredo do .env escondido e Parar.
 */
const NOTION_TOKEN = 'ntn_E2E_SERVIDORES_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const SECRET = 'segredo-do-env-e2e-123'
// Um servidor HTTP mínimo: imprime o segredo do .env (a tela deve esconder) e escuta em $PORT.
const SERVER = `node -e "console.log('DB=' + require('fs').readFileSync('.env','utf8').trim()); require('http').createServer((q, r) => r.end('ok')).listen(process.env.PORT, () => console.log('pronto em', process.env.PORT))"`

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  const origin = join(work, 'origin.git')
  git(work, 'init', '-q', '--bare', '-b', 'main', origin)
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  writeFileSync(join(repoDir(), '.env'), `SECRET=${SECRET}\n`)
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', origin)
  git(repoDir(), 'push', '-q', 'origin', 'main')
  seedConfig(userDataDir, {
    id: 'proj-servers',
    name: 'orkio-app',
    localPath: repoDir(),
    repo: FAKE_REPO
  })
})

test.afterAll(async () => {
  await orkio?.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

function servers(panel: Locator): Locator {
  return panel.getByRole('region', { name: 'Servidores' })
}

test('cadastra o servidor, sobe na pasta da tarefa, abre, mostra o log e para', async () => {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN] },
    { startPage: 'integrations' }
  )
  const { page, app } = orkio
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')
  await navTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()

  // Cadastro: Configurações › Servidores, "Adicionar servidor" num modal.
  await openSettings(page, 'Servidores')
  await page.getByRole('button', { name: 'Adicionar servidor' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Nome' }).fill('Web')
  await dialog.getByRole('textbox', { name: 'Comando' }).fill(SERVER)
  await dialog.getByRole('button', { name: 'Salvar servidor' }).click()
  await expect(dialog.getByText(/letras minúsculas/)).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Nome' }).fill('web')
  await dialog.getByRole('button', { name: 'Salvar servidor' }).click()
  await expect(dialog).toBeHidden()
  const list = page.getByRole('list', { name: 'Servidores do projeto' })
  await expect(list.getByText('web', { exact: true })).toBeVisible()

  // A tarefa ganha a pasta de trabalho com a primeira mensagem.
  await navTo(page, 'Quadro')
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const screen = taskScreen(page, 'ORK-2')
  const session = screen.getByRole('region', { name: 'Sessão da tarefa' })
  await session
    .getByRole('textbox', { name: 'Mensagem para o Claude Code' })
    .fill('Comece pelo começo')
  await session.getByRole('button', { name: 'Enviar' }).click()
  await expect(session.getByTestId('run-status').last()).toHaveText('Concluída', {
    timeout: 30_000
  })

  const panel = await taskTab(screen, 'Detalhes')
  const box = servers(panel)
  const row = box.getByRole('listitem', { name: 'Servidor web' })
  await expect(row.getByTestId('server-state')).toHaveText('Parado')
  await row.getByRole('button', { name: 'Subir web' }).click()
  await expect(row.getByTestId('server-state')).toHaveText('Rodando', { timeout: 30_000 })
  const url = await row.getByRole('button', { name: /localhost:\d+/ }).textContent()
  const port = Number(/:(\d+)/.exec(url ?? '')?.[1])
  expect(port).toBeGreaterThanOrEqual(4100)
  // A porta responde de verdade (processo no worktree), conferida de fora do app.
  expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe('ok')

  // Abrir: o main monta e abre só a URL do servidor de pé.
  await row.getByRole('button', { name: /localhost:\d+/ }).click()
  await expect.poll(() => openedUrls(app)).toContain(`http://localhost:${port}`)

  // Log: terminal só leitura, com o valor do .env escondido.
  await row.getByRole('button', { name: 'Ver log de web' }).click()
  const log = page.getByRole('dialog', { name: 'Log de web' })
  await expect(log).toBeVisible()
  const terminalId = await log.locator('[data-terminal-id]').getAttribute('data-terminal-id')
  const text = await page.evaluate(
    async (id) => (await window.orkio.terminal.snapshot(id ?? ''))?.data ?? '',
    terminalId
  )
  expect(text).toContain('pronto em')
  expect(text).not.toContain(SECRET)
  await page.keyboard.press('Escape')
  await expect(log).toBeHidden()

  // O terminal do servidor não aparece na tela Terminais (fechar lá mataria o servidor).
  const terms = await page.evaluate(() => window.orkio.terminal.all())
  expect(terms.ok && terms.value.terminals.some((t) => t.kind === 'server')).toBe(false)

  await row.getByRole('button', { name: 'Parar web' }).click()
  await expect(row.getByTestId('server-state')).toHaveText('Parado', { timeout: 15_000 })
  await expectTaskHistory(screen, `Servidor web subiu na porta ${port}`, 'Servidor web parado')
  expect(await cspViolations(page)).toEqual([])

  // Fechar o app com o servidor de pé não deixa processo órfão.
  await row.getByRole('button', { name: 'Subir web' }).click()
  await expect(row.getByTestId('server-state')).toHaveText('Rodando', { timeout: 30_000 })
  await app.close()
  orkio = null
  await expect
    .poll(
      () =>
        fetch(`http://localhost:${port}/`).then(
          () => 'respondeu',
          () => 'fechada'
        ),
      { timeout: 15_000 }
    )
    .toBe('fechada')
})

test('o agente sobe o servidor pela ferramenta do Orkio e sabe o endereço', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] })
  const { page } = orkio
  await navTo(page, 'Quadro')
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const screen = taskScreen(page, 'ORK-2')
  const session = screen.getByRole('region', { name: 'Sessão da tarefa' })
  await session.getByRole('textbox', { name: 'Mensagem para o Claude Code' }).fill('subir-servidor')
  await session.getByRole('button', { name: 'Enviar' }).click()
  await expect(session.getByTestId('run-status').last()).toHaveText('Concluída', {
    timeout: 60_000
  })
  // O prompt trouxe a linha dos servidores e a ferramenta subiu o "web" e devolveu o endereço.
  await expect(session.getByText('prompt: com servidores')).toBeVisible()
  await expect(session.getByText(/subir: web está de pé em http:\/\/localhost:\d+/)).toBeVisible()
  await expect(session.getByText(/- web: rodando em http:\/\/localhost:\d+/)).toBeVisible()

  // O servidor continua de pé depois do fim da mensagem, no painel e na porta.
  const panel = await taskTab(screen, 'Detalhes')
  const row = servers(panel).getByRole('listitem', { name: 'Servidor web' })
  await expect(row.getByTestId('server-state')).toHaveText('Rodando')
  const url = await row.getByRole('button', { name: /localhost:\d+/ }).textContent()
  const port = Number(/:(\d+)/.exec(url ?? '')?.[1])
  expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe('ok')
  await expectTaskHistory(screen, `Servidor web subiu na porta ${port}`)
  await row.getByRole('button', { name: 'Parar web' }).click()
  await expect(row.getByTestId('server-state')).toHaveText('Parado', { timeout: 15_000 })
})

test('com o servidor de pé, o Playwright navega até ele e clica sem pedir permissão', async () => {
  const { page } = orkio!
  const screen = taskScreen(page, 'ORK-2')
  const session = screen.getByRole('region', { name: 'Sessão da tarefa' })
  await session
    .getByRole('textbox', { name: 'Mensagem para o Claude Code' })
    .fill('navegar-servidor')
  await session.getByRole('button', { name: 'Enviar' }).click()
  await expect(session.getByTestId('run-status').last()).toHaveText('Concluída', {
    timeout: 60_000
  })
  await expect(session.getByText('navegar: allow · clicar: allow')).toBeVisible()
  const panel = await taskTab(screen, 'Detalhes')
  const row = servers(panel).getByRole('listitem', { name: 'Servidor web' })
  await row.getByRole('button', { name: 'Parar web' }).click()
  await expect(row.getByTestId('server-state')).toHaveText('Parado', { timeout: 15_000 })
})
