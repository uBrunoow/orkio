import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  FAKE_REPO,
  launchOrkio,
  navTo,
  removeDir,
  seedConfig,
  taskScreen,
  taskTab,
  type OrkioApp
} from './fixtures'

/**
 * Fase 1 — Tarefas: "Como deve rodar?" (padrão da coluna pela tela Tarefas, troca por tarefa),
 * o fluxo nativo "Rodar uma vez" sem o alva-flow (implementa → revisão por outro agente → gate do
 * diff) e o kanban derivado (a tarefa aparece em "Precisa de você" calculada do fluxo).
 */
const NOTION_TOKEN = 'ntn_E2E_TASKS_TOKEN_abcdef123456'
const PROJECT = 'proj-tasks'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const worktree = (): string => join(userDataDir, 'worktrees', PROJECT, 'ORK-2')
const agentArgs = (): Record<string, unknown>[] =>
  readFileSync(join(worktree(), '.orkio', 'agent-args.log'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>)

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}

function lane(page: Page, name: string) {
  return page.getByRole('list', { name: 'Raias das tarefas' }).getByRole('listitem', {
    name,
    exact: true
  })
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git(work, 'init', '-q', '--bare', '-b', 'main', join(work, 'origin.git'))
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', join(work, 'origin.git'))
  git(repoDir(), 'push', '-q', 'origin', 'main')
  seedConfig(userDataDir, { id: PROJECT, name: 'orkio-app', localPath: repoDir(), repo: FAKE_REPO })
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('Tarefas: modelo na coluna, "Rodar uma vez" nativo com revisor e o kanban derivado', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), NOTION_TOKEN)
  await navTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  // Tarefas vazia = ponto de partida: escolher como a coluna de trabalho roda.
  await navTo(page, 'Tarefas')
  await expect(page.getByRole('heading', { name: 'Nada em andamento ainda' })).toBeVisible()
  const start = page.getByRole('region', { name: 'Começar de um modelo' })
  await expect(start.getByRole('radio', { name: /^Rodar uma vez/ })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await start.getByRole('button', { name: 'Usar em Em andamento' }).click()
  await expect(start.getByRole('status')).toContainText('Rodar uma vez')

  // "Como as colunas rodam" mostra o padrão salvo (Simples | Avançado).
  await page.getByRole('button', { name: 'Como as colunas rodam' }).click()
  const dialog = page.getByTestId('column-setups')
  await expect(dialog.getByRole('radio', { name: /^Rodar uma vez/ })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await dialog.getByRole('radio', { name: 'Avançado' }).click()
  await expect(dialog.getByRole('combobox', { name: /^Quem revisa/ })).toContainText(
    'Padrão do Orkio (Revisor)'
  )
  await dialog.getByRole('button', { name: 'Fechar' }).first().click()

  // Na tarefa: herda da coluna; "Rodar agora" roda o fluxo nativo.
  await navTo(page, 'Quadro')
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const screen = taskScreen(page, 'ORK-2')
  await expect(screen).toBeVisible()
  const details = await taskTab(screen, 'Detalhes')
  const setup = details.getByRole('region', { name: 'Como deve rodar?' })
  await expect(
    setup.getByRole('radio', { name: /^Como a coluna manda: Rodar uma vez/ })
  ).toHaveAttribute('aria-checked', 'true')
  await setup.getByRole('radio', { name: 'Avançado' }).click()
  await expect(setup.getByText('Padrão do Orkio').first()).toBeVisible()
  await expect(setup.getByTestId('setup-runs')).toContainText('Rodar uma vez')
  await setup.getByRole('button', { name: 'Rodar agora' }).click()

  // Implementa (sem agente) → revisão pelo Revisor (só leitura, sessão própria) → gate do diff.
  await expect(setup.getByText(/Travado enquanto o fluxo roda/)).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(
      () => {
        try {
          return agentArgs().length
        } catch {
          return 0
        }
      },
      { timeout: 30_000 }
    )
    .toBe(2)
  const [implement, review] = agentArgs()
  expect(implement!['appendSystemPrompt']).toBeNull()
  expect(String(review!['appendSystemPrompt'])).toContain('Revisor')
  expect(review!['disallowedTools']).toContain('Write')
  expect(review!['resume']).toBeNull()

  // Fase 3: revisão até ficar limpo. O Orkio gravou o diff para o revisor; o `git diff` dele num
  // passo só de leitura passou sem pedir aprovação; ele anotou na memória pela ferramenta
  // "lembrar"; a rodada ficou em .orkio/revisao/rodada-1.md.
  await expect
    .poll(
      () => {
        try {
          return readFileSync(join(worktree(), '.orkio', 'review-tools.log'), 'utf8')
        } catch {
          return ''
        }
      },
      { timeout: 20_000 }
    )
    .toContain('lembrar:ok')
  const tools = readFileSync(join(worktree(), '.orkio', 'review-tools.log'), 'utf8')
  expect(tools).toContain('diff.md:true')
  expect(tools).toContain('git diff:allow')
  await expect
    .poll(
      () => {
        try {
          return readFileSync(join(worktree(), '.orkio', 'revisao', 'rodada-1.md'), 'utf8')
        } catch {
          return ''
        }
      },
      { timeout: 20_000 }
    )
    .toContain('## Bloqueios')
  // A memória do revisor entra no início da conversa dele.
  expect(String(review!['appendSystemPrompt'])).toContain('## Sua memória')

  // Kanban derivado: a tarefa espera você (o gate do diff), sem estado manual.
  await navTo(page, 'Tarefas')
  const needsYou = lane(page, 'Precisa de você')
  await expect(needsYou.getByRole('listitem', { name: 'ORK-2' })).toBeVisible({ timeout: 20_000 })
  await expect(needsYou.getByRole('listitem', { name: 'ORK-2' })).toContainText('Conferir o diff')
  await page.getByRole('button', { name: 'Precisa de atenção' }).click()
  await expect(needsYou.getByRole('listitem', { name: 'ORK-2' })).toBeVisible()
  // Lista: a mesma tarefa, com o estado.
  await page.getByRole('radio', { name: 'Lista' }).click()
  await expect(page.getByRole('table', { name: 'Lista de tarefas' })).toContainText(
    'Precisa de você'
  )
  // Clicar abre a tarefa.
  await page.getByRole('table', { name: 'Lista de tarefas' }).getByRole('button').first().click()
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()

  // A nota que o Revisor anotou aparece em Agentes › Memória.
  await navTo(page, 'Agentes')
  await page.getByRole('button', { name: 'Memória de Revisor' }).first().click()
  const memory = page.getByRole('region', { name: 'Memória de Revisor' })
  await expect(memory.getByRole('list', { name: 'Notas' })).toContainText(
    'Neste projeto os testes ficam ao lado do código.'
  )
  await expect(memory).toContainText('Só neste projeto')

  expect(await cspViolations(page)).toEqual([])
})
