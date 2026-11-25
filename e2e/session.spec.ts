import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  launchOrkio,
  NOTION_TASK_IDS,
  removeDir,
  type OrkioApp,
  navTo,
  taskScreen,
  FAKE_REPO,
  seedConfig
} from './fixtures'

/**
 * Fase 2 (Sessão): terminal embutido na pasta da tarefa e "Continuar no Claude" (a sessão vai
 * para o terminal travada e volta com "O Claude continua o passo"). Claude Code SIMULADO: sem
 * `-p`, o `e2e/fake-claude/claude` imita a tela interativa e grava `.orkio/terminal-claude.log`.
 */
const NOTION_TOKEN = 'ntn_E2E_SESSAO_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const worktree = (): string => join(userDataDir, 'worktrees', 'proj-sessao', 'ORK-2')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
function session(page: Page): Locator {
  return taskScreen(page, 'ORK-2').getByRole('region', { name: 'Sessão da tarefa' })
}
function argsLog(): Record<string, unknown>[] {
  return readFileSync(join(worktree(), '.orkio', 'agent-args.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}
function terminalClaudeLog(): { args: string[]; cwd: string; tty: boolean }[] {
  const file = join(worktree(), '.orkio', 'terminal-claude.log')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; cwd: string; tty: boolean })
}
/** O que o terminal mostrou (a saída guardada no main, o mesmo que o xterm desenha). */
async function terminalText(page: Page): Promise<string> {
  const id = await page.locator('[data-terminal-id]').getAttribute('data-terminal-id')
  if (!id) return ''
  return page.evaluate(async (tid) => (await window.orkio.terminal.snapshot(tid))?.data ?? '', id)
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
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', origin)
  git(repoDir(), 'push', '-q', 'origin', 'main')
  seedConfig(userDataDir, {
    id: 'proj-sessao',
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

test('primeira mensagem abre a sessão da tarefa', async () => {
  orkio = await launchOrkio(
    userDataDir,
    { validTokens: [NOTION_TOKEN] },
    { startPage: 'integrations' }
  )
  const { page } = orkio
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
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const section = session(page)
  await section
    .getByRole('textbox', { name: 'Mensagem para o Claude Code' })
    .fill('Comece pelo começo')
  await section.getByRole('button', { name: 'Enviar' }).click()
  await expect(section.getByTestId('run-status').last()).toHaveText('Concluída', {
    timeout: 30_000
  })
})

test('terminal embutido abre na pasta da tarefa e recebe as teclas', async () => {
  const { page } = orkio!
  await page.keyboard.press('Control+Shift+J')
  const start = page.getByRole('button', { name: /Abrir um terminal na pasta da tarefa/ })
  await expect(start).toBeVisible()
  await start.click()
  const term = page.locator('[data-terminal-id]')
  await expect(term).toBeVisible()
  // O xterm fica com o foco: as teclas vão para o shell (não para os atalhos do app).
  await page.keyboard.type('echo orkio-$((40+2)) && pwd')
  await page.keyboard.press('Enter')
  await expect.poll(() => terminalText(page), { timeout: 15_000 }).toContain('orkio-42')
  expect(await terminalText(page)).toContain(worktree())
  // A aba ganhou o nome do terminal da tarefa e voltar para ela redesenha a saída.
  await page.getByRole('button', { name: 'Ver tarefa' }).click()
  await expect(session(page)).toBeVisible()
  await page.keyboard.press('Control+Shift+J')
  await expect.poll(() => terminalText(page)).toContain('orkio-42')
  expect(await cspViolations(page)).toEqual([])
})

test('Continuar no Claude: sessão travada no terminal e devolvida ao Orkio', async () => {
  const { page } = orkio!
  await page.getByRole('button', { name: 'Ver tarefa' }).click()
  const section = session(page)
  const sessionId = argsLog().at(-1)!['sessionId'] as string
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)

  await section.getByRole('button', { name: 'Continuar no Claude' }).click()
  // Vai para a aba Terminal com o Claude retomando a sessão da tarefa.
  const bar = page.getByTestId('handoff-bar')
  await expect(bar).toContainText('Com você no terminal')
  await expect(bar).toContainText('não as regras do Orkio')
  await expect.poll(() => terminalClaudeLog().length).toBe(1)
  const call = terminalClaudeLog()[0]!
  expect(call.args).toEqual(['--resume', sessionId])
  expect(realpathSync(call.cwd)).toBe(realpathSync(worktree()))
  expect(call.tty).toBe(true)
  await expect.poll(() => terminalText(page)).toContain(`Sessão: ${sessionId}`)
  await page.locator('[data-terminal-id]').click()
  await page.keyboard.type('aprovei na mão')
  await page.keyboard.press('Enter')
  await expect.poll(() => terminalText(page)).toContain('Você disse: aprovei na mão')

  // Travada: o Orkio não roda nada na tarefa enquanto a sessão está com você.
  const refused = await page.evaluate(
    (taskId) => window.orkio.claude.send({ projectId: 'proj-sessao', taskId, text: 'oi' }),
    NOTION_TASK_IDS.ork2
  )
  expect(refused.ok).toBe(false)
  if (!refused.ok) expect(refused.error.code).toBe('handoff')
  // No sino / "Precisa de você".
  const waiting = await page.evaluate(async () => {
    const r = await window.orkio.overview.get()
    return r.ok ? r.value.waiting.map((w) => [w.kind, w.what]) : null
  })
  expect(waiting).toEqual([['handoff', 'Com você no terminal']])

  // Na tarefa, o campo dá lugar ao aviso com os dois jeitos de devolver.
  await page.getByRole('button', { name: 'Ver tarefa' }).click()
  await expect(section.getByTestId('handoff-bar')).toBeVisible()
  await expect(section.getByRole('textbox', { name: 'Mensagem para o Claude Code' })).toHaveCount(0)
  const runs = argsLog().length
  await section.getByRole('button', { name: 'O Claude continua o passo' }).click()
  await expect(section.getByTestId('handoff-bar')).toHaveCount(0)
  // Sem fluxo: a sessão continua no Orkio com o aviso de que você voltou do terminal.
  await expect.poll(() => argsLog().length, { timeout: 30_000 }).toBe(runs + 1)
  expect(argsLog().at(-1)!['resume']).toBe(sessionId)
  await expect(section.getByTestId('run-status').last()).toHaveText('Concluída', {
    timeout: 30_000
  })
  await expect(section.getByTestId('session-run').last()).toContainText('Voltei do terminal')
  const after = await page.evaluate(async () => {
    const r = await window.orkio.overview.get()
    return r.ok ? r.value.waiting.length : null
  })
  expect(after).toBe(0)
  expect(await cspViolations(page)).toEqual([])
})
