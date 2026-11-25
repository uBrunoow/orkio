import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  FAKE_REPO,
  launchOrkio,
  navTo,
  NOTION_TASK_IDS,
  openSettings,
  removeDir,
  seedConfig,
  taskScreen,
  type OrkioApp
} from './fixtures'

/**
 * Fase 4 — Configurações, Segredos e MCPs: menu com busca e "Vale para", um segredo guardado pela
 * tela (o valor nunca volta), o GitHub do catálogo com esse segredo (nasce desligado; ligado entra
 * no `--mcp-config` com o valor só no arquivo), os servidores do Claude do usuário só leitura
 * (sem valores) e uma skill desligada no projeto (`Skill(nome)` no deny).
 */
const NOTION_TOKEN = 'ntn_E2E_CONFIG_TOKEN_abcdef123456'
const PAT = 'ghp_E2EPATNAOPODEVAZAR0123456789abcdef'
const CLAUDE_SECRET = 'segredo-do-claude-json-777'
const PROJECT = 'proj-config'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const worktree = (): string => join(userDataDir, 'worktrees', PROJECT, 'ORK-2')
const sha = (v: string): string => createHash('sha256').update(v).digest('hex')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
function argsLog(): Record<string, unknown>[] {
  return readFileSync(join(worktree(), '.orkio', 'agent-args.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}
function page(): Page {
  return orkio!.page
}
function settingsNav(p: Page): Locator {
  return p.getByRole('navigation', { name: 'Configurações' })
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
  // Skill do projeto (o Claude Code enxerga) para desligar pela tela.
  mkdirSync(join(repoDir(), '.claude', 'skills', 'escrever'), { recursive: true })
  writeFileSync(
    join(repoDir(), '.claude', 'skills', 'escrever', 'SKILL.md'),
    '---\nname: escrever\ndescription: Escreve a documentação\n---\nCORPO'
  )
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', origin)
  git(repoDir(), 'push', '-q', 'origin', 'main')
  seedConfig(userDataDir, { id: PROJECT, name: 'orkio-app', localPath: repoDir(), repo: FAKE_REPO })
  // O Claude Code "do usuário" já carrega um servidor com um segredo no ambiente.
  const home = `${userDataDir}-home`
  mkdirSync(home, { recursive: true })
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        docs: { command: 'npx', args: ['-y', '@x/docs'], env: { DOCS_TOKEN: CLAUDE_SECRET } }
      },
      oauthAccount: { emailAddress: 'nao-pode-aparecer@example.com' }
    })
  )
})

test.afterAll(async () => {
  await orkio?.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('menu agrupado com busca e "Vale para"; segredo guardado nunca volta', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  const p = page()
  const s = await p.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')

  await openSettings(p, 'Integrações')
  const search = settingsNav(p).getByRole('searchbox', { name: 'Buscar configuração' })
  await search.fill('segredo')
  await expect(settingsNav(p).getByRole('button', { name: 'Segredos', exact: true })).toBeVisible()
  await expect(settingsNav(p).getByRole('button', { name: 'Aparência', exact: true })).toHaveCount(
    0
  )
  await search.fill('')

  await openSettings(p, 'Segredos')
  await expect(p.getByRole('heading', { level: 1, name: 'Segredos' })).toBeVisible()
  await expect(p.getByTestId('applies-to').first()).toContainText('Vale para:')

  await p.getByRole('button', { name: 'Token do GitHub para o MCP' }).click()
  const form = p.getByRole('form', { name: 'Novo segredo' })
  await expect(form.getByRole('textbox', { name: 'Nome do segredo' })).toHaveValue(
    'GITHUB_MCP_TOKEN'
  )
  await form.getByLabel('Valor', { exact: true }).fill(PAT)
  await form.getByRole('button', { name: 'Guardar segredo' }).click()
  await expect(p.getByText('Guardado. O Orkio não mostra o valor de novo.')).toBeVisible()
  await expect(p.getByTestId('secret-row').filter({ hasText: 'GITHUB_MCP_TOKEN' })).toBeVisible()

  expect(await p.content()).not.toContain(PAT)
  expect(JSON.stringify(await p.evaluate(() => window.orkio.vault.get()))).not.toContain(PAT)
  // Nada em texto puro no disco do Orkio (só o arquivo criptografado).
  expect(readFileSync(join(userDataDir, 'orkio-config.json'), 'utf8')).not.toContain(PAT)
})

test('MCP: GitHub do catálogo nasce desligado; os do seu Claude só leitura, sem valores', async () => {
  const p = page()
  await openSettings(p, 'Servidores MCP')
  await expect(p.getByRole('heading', { level: 1, name: 'Servidores MCP' })).toBeVisible()

  // Já no seu Claude Code: nome e resumo, nunca o valor nem a conta.
  const claude = p.getByRole('region', { name: 'Já no seu Claude Code' })
  await expect(claude.getByTestId('claude-mcp-row').filter({ hasText: 'docs' })).toContainText(
    'npx -y @x/docs'
  )
  expect(await p.content()).not.toContain(CLAUDE_SECRET)
  expect(await p.content()).not.toContain('nao-pode-aparecer@example.com')
  expect(JSON.stringify(await p.evaluate(() => window.orkio.mcp.get()))).not.toContain(
    CLAUDE_SECRET
  )

  const card = p.getByTestId('mcp-catalog-github')
  await card.getByRole('button', { name: 'Adicionar GitHub' }).click()
  const add = p.getByRole('form', { name: 'Adicionar GitHub ao Orkio' })
  await expect(add.getByTestId('mcp-launch')).toContainText('api.githubcopilot.com')
  await add.getByRole('combobox', { name: /^Token do GitHub/ }).click()
  await p
    .getByRole('option', { name: /^GITHUB_MCP_TOKEN/ })
    .first()
    .click()
  await add.getByRole('button', { name: 'Adicionar ao Orkio' }).click()

  const server = p.getByTestId('mcp-server-github')
  await expect(server).toBeVisible()
  await expect(server.getByTestId('mcp-state')).toContainText('Desligado')
  const toggle = server.getByRole('switch', { name: 'Ligado: GitHub' })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()

  // Copiar do Claude: chega desligado e o segredo vira referência (falta criar no Vault).
  await claude.getByRole('button', { name: 'Copiar docs para o Orkio' }).click()
  await expect(claude.getByText('Já copiado')).toBeVisible()
  await expect(p.getByTestId('mcp-server-docs')).toBeVisible()
  expect(readFileSync(join(userDataDir, 'orkio-config.json'), 'utf8')).not.toContain(CLAUDE_SECRET)
})

test('skill desligada no projeto e a execução recebe o servidor ligado e o deny', async () => {
  const p = page()
  await navTo(p, 'Quadro')
  await p
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(p.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  await openSettings(p, 'Skills')
  const row = p.getByTestId('skill-row').filter({ hasText: 'escrever' })
  const sw = row.getByRole('switch', { name: 'Ligada neste projeto: escrever' })
  await expect(sw).toBeChecked()
  await sw.click()
  await expect(sw).not.toBeChecked()

  await navTo(p, 'Quadro')
  await p.getByRole('listitem', { name: ORK2, exact: true }).click()
  const session = taskScreen(p, 'ORK-2').getByRole('region', { name: 'Sessão da tarefa' })
  await session.getByRole('textbox', { name: 'Mensagem para o Claude Code' }).fill('Comece')
  await session.getByRole('button', { name: 'Enviar' }).click()
  await expect(session.getByTestId('run-status').last()).toHaveText('Concluída', {
    timeout: 30_000
  })

  const last = argsLog().at(-1)!
  // Só o GitHub (ligado); o "docs" copiado está desligado e não roda.
  expect(last['mcp']).toEqual({
    github: {
      type: 'http',
      command: null,
      url: 'https://api.githubcopilot.com/mcp/',
      values: { Authorization: sha(`Bearer ${PAT}`) }
    }
  })
  expect(last['deny']).toEqual(['Skill(escrever)'])
  // O log da execução mostra só nomes.
  const log = await p.evaluate(
    async ({ projectId, taskId }) => {
      const state = await window.orkio.claude.state(projectId, taskId)
      if (!state.ok) return ''
      const run = state.value.runs[0]
      return run ? JSON.stringify(await window.orkio.claude.readLog(run.id)) : ''
    },
    { projectId: PROJECT, taskId: NOTION_TASK_IDS.ork2 }
  )
  expect(log).toContain('Servidores MCP do Orkio nesta execução: GitHub.')
  expect(log).toContain('Skills desligadas neste projeto: escrever.')
  expect(log).not.toContain(PAT)
  expect(await p.content()).not.toContain(PAT)
  expect(await cspViolations(p)).toEqual([])
})
