import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  launchOrkio,
  removeDir,
  type OrkioApp,
  navTo,
  expectTaskHistory
} from './fixtures'

/**
 * Etapa 5A: fluxos de tarefa com o Claude Code SIMULADO (e2e/fake-claude/claude) e git real.
 * Monta o fluxo pela tela, liga numa coluna, dispara ao mover, aprova o gate, e retoma depois de
 * fechar o app no meio de um passo.
 */
const NOTION_TOKEN = 'ntn_E2E_FLOWS_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

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
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Selector da Astryx: gatilho (botão/combobox) pelo começo do rótulo; opção pelo começo do nome. */
async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  const name = new RegExp(`^${esc(label)}( |$)`)
  await scope
    .getByRole('combobox', { name })
    .or(scope.getByRole('button', { name }))
    .first()
    .click()
  // Perto do fim do painel a lista abre abaixo da janela; o clique é no DOM, sem checar a viewport.
  await page
    .getByRole('option', { name: new RegExp(`^${esc(option)}( |$)`) })
    .first()
    .evaluate((el) => (el as HTMLElement).click())
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
async function goToBoard(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Quadro' })
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
          id: 'proj-flows',
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

test('critérios 1–3: monta o fluxo (comandos, gate, salto), liga na coluna, dispara ao mover e conclui ao aprovar', async () => {
  const { page } = await open()
  const s = await page.evaluate(
    (t) => window.orkio.notion.connect({ kind: 'token', token: t }),
    NOTION_TOKEN
  )
  expect(s.state).toBe('connected')
  await goToBoard(page)
  await page
    .getByRole('region', { name: 'Criar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()
  await expect(card(page)).toBeVisible()

  // Editor de fluxos (a partir do Fluxo do projeto).
  await navTo(page, 'Fluxos')
  const editor = page.getByRole('region', { name: 'Fluxos do projeto' })
  await editor.getByRole('button', { name: 'Novo fluxo' }).click()
  await editor.getByRole('textbox', { name: 'Nome do fluxo' }).fill('Revisar e entregar')

  // "Adicionar passo" insere depois do passo aberto e abre o novo.
  const add = async (type: string): Promise<void> => {
    await editor.getByRole('button', { name: 'Adicionar passo' }).click()
    await page.getByRole('menuitem', { name: type }).click()
  }
  const step = (n: number) => editor.getByRole('region', { name: `Editar passo ${n}` })
  // 1. Comando do catálogo (agrupado por origem).
  await add('Comando do Claude Code')
  await choose(page, step(1), 'Comando', '/revisar')
  await step(1)
    .getByRole('textbox', { name: /^Argumentos/ })
    .fill('primeiro {{task_id}}')
  // 2. Gate.
  await add('Aprovação (gate)')
  // 3. Salto: o padrão volta para o passo 1 sem limite → erro de validação.
  await add('Salto condicional')
  const problems = editor.getByRole('list', { name: 'Problemas do fluxo' })
  await expect(problems).toContainText('volta para trás sem limite')
  await expect(editor.getByRole('button', { name: 'Salvar fluxos' })).toBeDisabled()
  // 4 e 5. Outro comando e a ação de teste.
  await add('Comando do Claude Code')
  await choose(page, step(4), 'Comando', '/revisar')
  await step(4)
    .getByRole('textbox', { name: /^Argumentos/ })
    .fill('segundo')
  await add('Ação do Orkio')
  // Salto: se o passo 1 falhou → pula para a ação final (para frente: válido).
  await editor
    .getByRole('list', { name: 'Passos do fluxo' })
    .getByRole('listitem', { name: /^Passo 3:/ })
    .click()
  await choose(page, step(3), 'Resultado (condição 1)', 'falhou')
  await choose(page, step(3), 'Então ir para', 'Ação do Orkio (acao)')
  await expect(problems).toHaveCount(0)
  await editor.getByRole('button', { name: 'Salvar fluxos' }).click()
  await expect(editor.getByText('Fluxos salvos.')).toBeVisible()

  // Liga na coluna Revisando (ao entrar) e salva o Fluxo do projeto.
  await navTo(page, 'Etapas e automações')
  await page
    .getByRole('list', { name: 'Etapas do fluxo' })
    .getByRole('listitem', { name: 'Etapa Revisando' })
    .click()
  const rev = page.getByRole('region', { name: 'Etapa Revisando', exact: true })
  await choose(page, rev, 'Fluxo desta coluna', 'Revisar e entregar')
  await expect(rev.getByRole('radio', { name: 'Ao entrar' })).toBeChecked()
  await page
    .getByRole('region', { name: 'Validação do fluxo' })
    .getByRole('button', { name: 'Salvar fluxo' })
    .click()
  await expect(card(page)).toBeVisible()

  // Mover para Revisando dispara o fluxo.
  await card(page).getByRole('button', { name: 'Ações de ORK-2' }).click()
  await page.getByRole('menuitem', { name: 'Mover para Revisando' }).click()
  await expect(card(page).getByTestId('card-flow')).toHaveText('Esperando você', {
    timeout: 30_000
  })

  const panel = await openPanel(page)
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  await expect(flow.getByTestId('flow-status')).toHaveText('Esperando aprovação')
  const gate = flow.getByRole('group', { name: 'Aprovação do fluxo' })
  await expect(gate).toContainText('Pode seguir?')
  await expect(gate.getByRole('region', { name: 'Diff para aprovar' })).toContainText(
    'src/exportar.ts'
  )
  await gate.getByRole('button', { name: 'Aprovar' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })
  const timeline = flow.getByRole('list', { name: 'Linha do tempo do fluxo' })
  await expect(timeline.getByRole('listitem')).toHaveCount(4) // salto não executa nada
  await expect(timeline).toContainText('aprovado')
  await expect(card(page).getByTestId('card-flow')).toHaveCount(0)

  // A sessão conta o fluxo (eventos e as execuções dos passos); o histórico completo também.
  const conversation = panel.getByRole('list', { name: 'Conversa da tarefa' })
  await expect(conversation).toContainText('Fluxo iniciado: Revisar e entregar')
  await expect(conversation).toContainText('Aprovação concedida')
  await expect(conversation.getByTestId('session-run')).toHaveCount(2)
  await expectTaskHistory(
    panel,
    'Fluxo iniciado: Revisar e entregar',
    'Aprovação concedida',
    'Fluxo concluído'
  )

  // Fluxo em frase: como começa, os passos e a execução que acabou de acontecer.
  await navTo(page, 'Fluxos')
  await page
    .getByRole('list', { name: 'Fluxos do projeto' })
    .getByRole('listitem')
    .filter({ hasText: 'Revisar e entregar' })
    .click()
  const detail = page.getByRole('region', { name: 'Fluxo Revisar e entregar' })
  await expect(detail.getByTestId('detail-sentence')).toHaveText(
    'Quando a tarefa entra em Revisando: /revisar, aprovação, salto, /revisar e Nada (teste).'
  )
  await expect(detail.getByRole('list', { name: 'Passos em frase' })).toContainText(
    'Pede sua aprovação'
  )
  await expect(detail.getByTestId('executions')).toContainText('Concluído')
  expect(await cspViolations(page)).toEqual([])
})

test('critério 4: fechar o app no meio de um passo e retomar ao reabrir', async () => {
  await close()
  // O 1º passo passa a demorar só na primeira vez (o simulado deixa um marcador no worktree).
  const file = join(userDataDir, 'orkio-config.json')
  const config = JSON.parse(readFileSync(file, 'utf8')) as {
    flows: Record<string, { flows: { steps: { args?: string }[] }[] }>
  }
  config.flows['proj-flows']!.flows[0]!.steps[0]!.args = 'demorar-uma-vez'
  writeFileSync(file, JSON.stringify(config))

  let { page } = await open()
  await goToBoard(page)
  let panel = await openPanel(page)
  let flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  await flow.getByRole('button', { name: 'Rodar fluxo de novo' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Rodando')
  // Rodapé do painel: quem está trabalhando, há quanto tempo e em qual passo.
  await expect(panel.getByTestId('task-working')).toContainText('Fluxo trabalhando há')
  await expect(panel.getByRole('list', { name: 'Log da execução' }).last()).toContainText(
    'Primeira vez: trabalhando',
    { timeout: 30_000 }
  )

  // Fecha com o passo rodando.
  await close()
  ;({ page } = await open())
  await goToBoard(page)
  await expect(card(page).getByTestId('card-flow')).toHaveText('Esperando você')
  panel = await openPanel(page)
  flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  await expect(flow.getByTestId('flow-status')).toHaveText('Pausado')
  await expect(flow).toContainText('O Orkio foi fechado no meio do passo')
  await expect(flow.getByRole('list', { name: 'Linha do tempo do fluxo' })).toContainText(
    'interrompido'
  )

  await flow.getByRole('button', { name: 'Retomar deste passo' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Esperando aprovação', {
    timeout: 30_000
  })
  await flow
    .getByRole('group', { name: 'Aprovação do fluxo' })
    .getByRole('button', { name: 'Aprovar' })
    .click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Concluído', { timeout: 30_000 })
})

test('critério 5: passo que falha pausa o fluxo e nada segue sozinho', async () => {
  await close()
  const file = join(userDataDir, 'orkio-config.json')
  const config = JSON.parse(readFileSync(file, 'utf8')) as {
    flows: Record<string, { flows: { steps: { args?: string }[] }[] }>
  }
  config.flows['proj-flows']!.flows[0]!.steps[0]!.args = 'falhar'
  writeFileSync(file, JSON.stringify(config))

  const { page } = await open()
  await goToBoard(page)
  const panel = await openPanel(page)
  const flow = panel.getByRole('region', { name: 'Fluxo da tarefa' })
  await flow.getByRole('button', { name: 'Rodar fluxo de novo' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Pausado', { timeout: 30_000 })
  await expect(flow).toContainText('Um passo falhou')
  // O cartão de problema: o que foi registrado, o que fazer e a sessão do passo.
  const problem = flow.getByRole('group', { name: 'Problema no fluxo' })
  await expect(problem).toContainText('O que o Orkio registrou')
  await expect(problem).toContainText('O Claude Code terminou com erro')
  await expect(problem).toContainText('A sessão do passo mostra o que aconteceu')
  await problem.getByRole('button', { name: 'Ver a sessão do passo' }).click()
  const failedRun = panel.getByTestId('session-run').last()
  await expect(failedRun.getByTestId('run-status')).toHaveText('Falhou')
  await expect(failedRun.getByRole('list', { name: 'Log da execução' })).toBeVisible()
  const timeline = flow.getByRole('list', { name: 'Linha do tempo do fluxo' })
  await expect(timeline.getByRole('listitem')).toHaveCount(1)
  await expect(timeline).toContainText('falhou')
  // Continua parado (não foi para o gate nem para o próximo passo).
  await page.waitForTimeout(1500)
  await expect(flow.getByTestId('flow-status')).toHaveText('Pausado')
  await expect(timeline.getByRole('listitem')).toHaveCount(1)

  // Responder e continuar: a resposta vai na mesma sessão do passo (sem rodar o comando do zero)
  // e, dando certo, o fluxo segue para o próximo passo (o gate).
  await problem
    .getByRole('textbox', { name: 'Responder ao Claude' })
    .fill('Formato: CSV; só admins')
  await problem.getByRole('button', { name: 'Responder e continuar' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Esperando aprovação', {
    timeout: 30_000
  })
  const conversation = panel.getByRole('list', { name: 'Conversa da tarefa' })
  await expect(conversation).toContainText('Formato: CSV; só admins')
  await expect(conversation).toContainText('Continuei a sessão: Formato: CSV; só admins')
  await flow.getByRole('button', { name: 'Cancelar fluxo' }).click()
  await expect(flow.getByTestId('flow-status')).toHaveText('Cancelado')
})
