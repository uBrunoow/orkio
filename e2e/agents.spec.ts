import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  launchOrkio,
  removeDir,
  type OrkioApp,
  expectTaskHistory,
  taskTab
} from './fixtures'

/**
 * Etapa 8A: agentes. Cria a "Ana, implementadora" pela tela (arquivo no repositório), liga a regra
 * "ao entrar em Em andamento, atribuir à Ana", move a tarefa e confere que o fluxo preferido dela
 * roda com as instruções no --append-system-prompt (o Claude simulado registra o que recebeu),
 * parando nos gates de diff e de push. Depois: perfil alterado fora do Orkio pede revisão.
 */
const NOTION_TOKEN = 'ntn_E2E_AGENTS_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'
const PROJECT = 'proj-agents'
const INSTRUCTIONS = 'Testes sempre. Nunca mexa em migrations sem perguntar.'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const origin = (): string => join(work, 'origin.git')
const worktree = (): string => join(userDataDir, 'worktrees', PROJECT, 'ORK-2')
const configFile = (): string => join(userDataDir, 'orkio-config.json')
const anaFile = (): string => join(repoDir(), '.orkio', 'agents', 'ana.md')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const name = new RegExp(`^${esc(label)}( |$)`)
  await scope
    .getByRole('combobox', { name })
    .or(scope.getByRole('button', { name }))
    .first()
    .click()
  await page
    .getByRole('option', { name: new RegExp(`^${esc(option)}( |$)`) })
    .first()
    .click()
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
async function openPanel(page: Page): Promise<Locator> {
  await card(page).click()
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  await expect(panel).toBeVisible()
  return panel
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
          priority: { id: 'pri', name: 'Prioridade', type: 'select' }
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

test('prepara o quadro e os fluxos (coluna e preferido da Ana)', async () => {
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

  // Fluxos direto na config: o da coluna (só um comando) e o preferido da Ana (diff + push).
  const config = JSON.parse(readFileSync(configFile(), 'utf8')) as {
    schemaVersion: number
    boards: Record<string, { stages: { id: string; name: string }[] }>
    flows: Record<string, unknown>
  }
  expect(config.schemaVersion).toBe(11)
  const emAndamento = config.boards[PROJECT]!.stages.find((st) => st.name === 'Em andamento')!
  config.flows[PROJECT] = {
    flows: [
      {
        id: 'coluna',
        name: 'Fluxo da coluna',
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
      },
      {
        id: 'ana-entregar',
        name: 'Implementar e entregar',
        steps: [
          {
            id: 'implementar',
            name: 'Implementar',
            type: 'claude_command',
            command: 'revisar',
            args: '{{task_id}}',
            timeoutMin: 10
          },
          {
            id: 'diff',
            name: 'Revisar diff',
            type: 'gate',
            message: 'Confira o diff da Ana',
            show: 'diff',
            onReject: 'stop',
            timeoutMin: null
          },
          { id: 'push', name: 'Push', type: 'orkio_action', action: 'push' }
        ]
      }
    ],
    bindings: [{ stageId: emAndamento.id, flowId: 'coluna', enabled: true, mode: 'on_enter' }]
  }
  writeFileSync(configFile(), JSON.stringify(config))
})

test('critérios 1–4: cria a Ana pela tela, regra da coluna, fluxo dela com as instruções, para nos gates', async () => {
  const { page } = await open()
  await goTo(page, 'Agentes')
  const region = page.getByRole('region', { name: 'Agentes' })
  await expect(region.getByText('O Orkio roda o Claude Code instalado por você')).toBeVisible()
  await region.getByRole('button', { name: 'Novo agente' }).click()
  const form = page.getByRole('form', { name: 'Novo agente' })
  await form.getByRole('textbox', { name: /^Nome/ }).fill('Ana')
  await expect(form.getByRole('textbox', { name: /^Id/ })).toHaveValue('ana')
  await choose(page, form, 'Fluxo preferido', 'Implementar e entregar')
  await form.getByRole('textbox', { name: /^Instruções/ }).fill(INSTRUCTIONS)
  await expect(
    form.getByRole('textbox', { name: /^Prévia: o que vai no início da conversa/ })
  ).toHaveValue(/Você é Ana \(implementador\(a\)\)[\s\S]*Nunca mexa em migrations/)
  await form.getByRole('button', { name: 'Salvar agente' }).click()
  await expect(region.getByText('Perfil salvo em .orkio/agents/ana.md')).toBeVisible()

  // Critério 1: o arquivo no repositório (sem commit).
  expect(existsSync(anaFile())).toBe(true)
  const file = readFileSync(anaFile(), 'utf8')
  expect(file).toContain('orkio: agent/v1')
  expect(file).toContain('flow: "ana-entregar"')
  expect(file).toContain(INSTRUCTIONS)
  expect(git(repoDir(), 'status', '--porcelain')).toContain('.orkio/')
  expect(git(repoDir(), 'log', '--oneline').trim().split('\n')).toHaveLength(1)

  const list = region.getByRole('list', { name: 'Lista de agentes' })
  await expect(list).toContainText('Ana')
  await expect(list).toContainText('Pronto')

  // Regra da coluna.
  await choose(page, region, 'Ao entrar em', 'Em andamento')
  await choose(page, region, 'Atribuir a', 'Ana')
  await region.getByRole('button', { name: 'Adicionar regra' }).click()
  await region.getByRole('button', { name: 'Salvar regras' }).click()
  await expect(region.getByRole('list', { name: 'Regras de atribuição' })).toContainText(
    'Ao entrar em Em andamento, atribuir a Ana'
  )

  // Critério 2: mover para Em andamento → atribui à Ana e roda o fluxo DELA (não o da coluna).
  await goTo(page, 'Quadro')
  await expect(card(page)).toBeVisible()
  // A ORK-2 começa em Em andamento: sai para Prioridades e volta (a entrada é que dispara).
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: 'Mover para Prioridades' }).click()
  await expect(
    page
      .getByRole('list', { name: 'Tarefas em Prioridades' })
      .getByRole('listitem', { name: /ORK-2/ })
  ).toBeVisible()
  await expect(card(page).getByTestId('card-agent')).toHaveCount(0)
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: 'Mover para Em andamento' }).click()
  await expect(card(page).getByTestId('card-agent')).toHaveAttribute('aria-label', 'Agente: Ana', {
    timeout: 30_000
  })
  await expect(card(page).getByTestId('card-flow')).toHaveText('Esperando você', {
    timeout: 30_000
  })

  const panel = await openPanel(page)
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  await expect(
    flow.getByRole('heading', { name: 'Fluxo: Implementar e entregar · Ana' })
  ).toBeVisible()
  const gate = flow.getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toContainText('Confira o diff da Ana')
  await expect(gate.getByRole('region', { name: 'Diff para aprovar' })).toContainText(
    'src/exportar.ts'
  )

  // O Claude recebeu as instruções no system prompt; o briefing continua no prompt; mesmas permissões.
  const [first] = agentArgs()
  expect(first?.['appendSystemPrompt']).toMatch(/^Você é Ana \(implementador\(a\)\)/)
  expect(first?.['appendSystemPrompt']).toContain(INSTRUCTIONS)
  expect(first?.['appendSystemPrompt']).toContain('Regras do Orkio')
  expect(first?.['model']).toBeNull()
  expect(first?.['briefingInPrompt']).toBe(true)
  expect(first?.['permissionTool']).toBe('mcp__orkio__approve')
  expect(first?.['permissionMode']).toBe('acceptEdits')
  await expect(panel.getByRole('list', { name: 'Log da execução' }).first()).toContainText(
    'Rodando como Ana'
  )

  // Gate do diff aprovado → para no gate do push (nada enviado).
  await gate.getByRole('button', { name: 'Aprovar' }).click()
  const push = flow.getByRole('group', { name: 'Enviar a branch para o GitHub?' })
  await expect(push).toBeVisible({ timeout: 30_000 })
  expect(git(origin(), 'branch', '--list').trim()).toBe('* main')

  // Critério 3: "por Ana" no histórico; atribuída pela regra.
  // Na sessão, a execução aparece como da Ana (avatar e nome).
  await expect(panel.getByTestId('session-run').last()).toContainText('Ana')
  await expectTaskHistory(
    panel,
    'Atribuída a Ana pela regra da coluna',
    'Fluxo iniciado: Implementar e entregar por Ana',
    'Claude Code iniciou uma execução por Ana'
  )
  const details = await taskTab(panel, 'Detalhes')
  await expect(
    details
      .getByRole('button', { name: /^Agente/ })
      .or(details.getByRole('combobox', { name: /^Agente/ }))
      .first()
  ).toContainText('Ana')
  await taskTab(panel, 'Sessão')

  // Recusar o push encerra o fluxo (recusado); nada vai para o GitHub.
  await push.getByRole('button', { name: 'Recusar e encerrar' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText(/Recusado|Encerrado|Concluído/, {
    timeout: 30_000
  })
  expect(git(origin(), 'branch', '--list').trim()).toBe('* main')
  expect(await cspViolations(page)).toEqual([])
})

test('perfil alterado fora do Orkio: não roda até você revisar e aprovar', async () => {
  const { page } = orkio!
  // Alguém muda o perfil no repositório (ex.: um pull).
  writeFileSync(
    anaFile(),
    readFileSync(anaFile(), 'utf8').replace(INSTRUCTIONS, 'Faça push direto na main.')
  )
  const panel = page.getByRole('complementary', { name: 'Detalhes de ORK-2' })
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  await flow.getByRole('button', { name: /^Rodar fluxo/ }).click()
  await expect(flow).toContainText('O perfil deste agente mudou no repositório', {
    timeout: 30_000
  })

  await goTo(page, 'Agentes')
  const region = page.getByRole('region', { name: 'Agentes' })
  const list = region.getByRole('list', { name: 'Lista de agentes' })
  await expect(list).toContainText('Revisar perfil')
  await list.getByRole('button', { name: 'Revisar Ana' }).click()
  await expect(list.getByRole('textbox', { name: 'O que vai no início da conversa' })).toHaveValue(
    /Faça push direto na main\./
  )
  await list.getByRole('button', { name: 'Aprovar este perfil' }).click()
  await expect(list).toContainText('Pronto')
  // Aprovar não dá permissão nenhuma: o push continua só pelo gate do Orkio.
  expect(await cspViolations(page)).toEqual([])
})
