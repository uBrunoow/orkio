import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
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
 * Quadro: badge "Precisa de você" e filtros pela situação; "Como deve rodar?" (padrão da coluna
 * pelo menu do Quadro, troca por tarefa) e o fluxo nativo "Rodar uma vez" sem o alva-flow
 * (implementa → revisão por outro agente → gate do diff). A tarefa aparece com o badge "Precisa de
 * você" calculado do fluxo.
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

test('Como deve rodar: modelo na coluna pelo Quadro, "Rodar uma vez" nativo com revisor e o badge no card', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  const { page } = orkio
  await page.evaluate((t) => window.orkio.notion.connect({ kind: 'token', token: t }), NOTION_TOKEN)
  await navTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  // "Como as colunas rodam" pelo menu do Quadro: a coluna aberta é a de trabalho (Em andamento).
  await page.getByRole('button', { name: 'Mais ações do quadro' }).click()
  await page.getByRole('menuitem', { name: 'Como as colunas rodam' }).click()
  const dialog = page.getByTestId('column-setups')
  await dialog.getByRole('radio', { name: /^Rodar uma vez/ }).click()
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
  // Sem agente: só as regras do Orkio (nada de "Você é …").
  expect(String(implement!['appendSystemPrompt'])).not.toContain('Você é')
  expect(String(implement!['appendSystemPrompt'])).toContain('Não grave o link da PR')
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

  // Badge no card: a tarefa espera você (o gate do diff), sem estado manual; os filtros a acham.
  await navTo(page, 'Quadro')
  const ork2 = page.getByRole('listitem', { name: ORK2, exact: true })
  await expect(ork2.getByTestId('card-lane')).toHaveText('Precisa de você', { timeout: 20_000 })
  await expect(ork2.getByTestId('card-detail')).toContainText('Conferir o diff')
  await expect(page.getByTestId('attention-count')).toHaveText('1')
  await page.getByRole('button', { name: /^Precisa de você/ }).click()
  await expect(ork2).toBeVisible()
  await page.getByRole('button', { name: 'Em revisão', exact: true }).click()
  await expect(ork2).toHaveCount(0)
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  // Lista: a mesma tarefa, com o badge; clicar abre a tarefa.
  await page.getByRole('radio', { name: 'Lista' }).click()
  await expect(page.getByTestId('board-list').getByRole('listitem', { name: ORK2 })).toContainText(
    'Precisa de você'
  )
  await page.getByTestId('board-list').getByRole('listitem', { name: ORK2 }).click()
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
