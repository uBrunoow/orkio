import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  expectTaskHistory,
  launchOrkio,
  removeDir,
  type OrkioApp
} from './fixtures'

/**
 * Etapa 8B: orquestrador + agentes embutidos. Sem criar agente nenhum: liga o orquestrador pela
 * tela com a sugestão (Prioridades → Em andamento com o Implementador → Revisando com o Revisor →
 * Revisado) e confere que a ORK-2 sai da fila e anda sozinha até "Revisado", com o fluxo de cada
 * coluna rodando como o agente certo (o Claude simulado registra o --append-system-prompt).
 */
const NOTION_TOKEN = 'ntn_E2E_ORCH_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const PROJECT = 'proj-orch'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const origin = (): string => join(work, 'origin.git')
const worktree = (): string => join(userDataDir, 'worktrees', PROJECT, 'ORK-2')
const configFile = (): string => join(userDataDir, 'orkio-config.json')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
async function open(): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] }, { startPage: 'projects' })
  return orkio
}
async function close(): Promise<void> {
  if (!orkio) return
  await orkio.app.close()
  orkio = null
}
async function goTo(page: Page, name: 'Quadro' | 'Agentes'): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name })
    .click()
}
function card(page: Page): Locator {
  return page.getByRole('listitem', { name: ORK2, exact: true })
}
const agentArgs = (): Record<string, unknown>[] =>
  readFileSync(join(worktree(), '.orkio', 'agent-args.log'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>)

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git(work, 'init', '-q', '--bare', '-b', 'main', origin())
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  git(repoDir(), 'remote', 'add', 'origin', origin())
  git(repoDir(), 'push', '-q', 'origin', 'main')
  writeFileSync(
    configFile(),
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
          priority: { id: 'pri', name: 'Prioridade', type: 'select' },
          assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
        },
        updatedAt: '2026-11-19T00:00:00.000Z'
      },
      projects: [
        {
          id: PROJECT,
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
  await close()
  removeDir(userDataDir)
  removeDir(work)
})

test('prepara o quadro e um fluxo por coluna de trabalho', async () => {
  const { page } = await open()
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')
  await goTo(page, 'Quadro')
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(card(page)).toBeVisible()
  await close()

  const config = JSON.parse(readFileSync(configFile(), 'utf8')) as {
    schemaVersion: number
    boards: Record<string, { stages: { id: string; name: string }[] }>
    flows: Record<string, unknown>
  }
  expect(config.schemaVersion).toBe(11)
  const stage = (name: string): string =>
    config.boards[PROJECT]!.stages.find((st) => st.name === name)!.id
  const oneStep = (id: string, name: string): unknown => ({
    id,
    name,
    steps: [
      {
        id: 'rodar',
        name: 'Rodar',
        type: 'claude_command',
        command: 'revisar',
        args: '',
        timeoutMin: 10
      }
    ]
  })
  config.flows[PROJECT] = {
    flows: [oneStep('implementar', 'Implementar'), oneStep('revisar', 'Revisar')],
    bindings: [
      { stageId: stage('Em andamento'), flowId: 'implementar', enabled: true, mode: 'on_enter' },
      { stageId: stage('Revisando'), flowId: 'revisar', enabled: true, mode: 'on_enter' }
    ]
  }
  writeFileSync(configFile(), JSON.stringify(config))
})

test('liga o orquestrador com a sugestão: a tarefa sai da fila e chega a Revisado sozinha', async () => {
  const { page } = await open()
  // A ORK-2 vai para a fila (Prioridades) antes de ligar o orquestrador. Nesta abertura: o Notion
  // simulado recomeça a cada abertura e a reconciliação a devolveria para "Em andamento".
  await goTo(page, 'Quadro')
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: 'Mover para Prioridades' }).click()
  await expect(
    page
      .getByRole('list', { name: 'Tarefas em Prioridades' })
      .getByRole('listitem', { name: /ORK-2/ })
  ).toBeVisible()

  await goTo(page, 'Agentes')
  const region = page.getByRole('region', { name: 'Agentes' })

  // Agentes embutidos aparecem prontos, sem arquivo; só dá para duplicar.
  const list = region.getByRole('list', { name: 'Lista de agentes' })
  const implementador = list.getByRole('listitem', { name: 'Implementador', exact: true })
  await expect(implementador).toContainText('Embutido')
  await expect(implementador).toContainText('Pronto')
  await expect(implementador.getByRole('button', { name: 'Duplicar Implementador' })).toBeVisible()
  await expect(implementador.getByRole('button', { name: 'Editar Implementador' })).toHaveCount(0)

  const orch = region.getByRole('region', { name: 'Orquestrador' })
  await expect(orch).toContainText('Desligado')
  await orch.getByRole('button', { name: 'Configurar orquestrador' }).click()
  const form = orch.getByRole('form', { name: 'Configurar orquestrador' })
  await expect(form.getByRole('group', { name: 'Etapa de trabalho 1' })).toContainText(
    'Implementador'
  )
  await expect(form.getByRole('group', { name: 'Etapa de trabalho 2' })).toContainText('Revisor')
  await form.getByRole('checkbox', { name: /^Ligar o orquestrador/ }).check()
  await form.getByRole('button', { name: 'Salvar orquestrador' }).click()
  await expect(orch.getByTestId('orchestrator-summary')).toHaveText(
    'Puxa de Prioridades → Em andamento (Implementador) → Revisando (Revisor) → Revisado.'
  )

  // A config guarda quando ligou (só fluxos que terminarem depois disso fazem a tarefa seguir).
  const saved = JSON.parse(readFileSync(configFile(), 'utf8')) as {
    orchestrator: Record<string, { enabled: boolean; enabledSince: string | null }>
  }
  expect(saved.orchestrator[PROJECT]?.enabled).toBe(true)
  expect(saved.orchestrator[PROJECT]?.enabledSince).toMatch(/^\d{4}-/)

  // Puxada da fila → Implementador → fluxo conclui → Revisando com o Revisor → Revisado.
  await goTo(page, 'Quadro')
  await expect(
    page.getByRole('list', { name: 'Tarefas em Revisado' }).getByRole('listitem', { name: /ORK-2/ })
  ).toBeVisible({ timeout: 60_000 })
  await expect(card(page).getByTestId('card-agent')).toHaveAttribute(
    'aria-label',
    'Agente: Revisor'
  )

  const runs = agentArgs()
  expect(runs).toHaveLength(2)
  expect(runs[0]?.['appendSystemPrompt']).toMatch(/^Você é Implementador \(implementador\(a\)\)/)
  expect(runs[1]?.['appendSystemPrompt']).toMatch(/^Você é Revisor \(revisor\(a\)\)/)
  // Mesmas permissões de sempre.
  expect(runs[1]?.['permissionTool']).toBe('mcp__orkio__approve')

  await card(page).click()
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  await expectTaskHistory(
    panel,
    'Atribuída a Implementador pelo orquestrador',
    'Orquestrador (puxada da fila): Prioridades → Em andamento',
    'Atribuída a Revisor pelo orquestrador',
    'Orquestrador (fluxo da etapa concluído): Em andamento → Revisando'
  )
  expect(git(origin(), 'branch', '--list').trim()).toBe('* main')
  expect(await cspViolations(page)).toEqual([])
})
