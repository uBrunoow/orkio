import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  launchOrkio,
  queueFolderPicks,
  removeDir,
  taskScreen,
  type OrkioApp
} from './fixtures'

/**
 * Reestruturação: Primeiros passos. Sem projeto o app abre neles; o GitHub é obrigatório; cada passo
 * vem do estado real (Notion, Claude Code, pasta, bancos e vínculo, quadro). Parar no meio deixa
 * "Falta N passo · continuar" na lista lateral, que volta ao primeiro passo pendente do projeto.
 */
const TOKEN = 'ntn_E2E_SETUP_TOKEN_abcdef123456'

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

const steps = (page: Page): Locator => page.getByRole('list', { name: 'Primeiros passos' })
const step = (page: Page, n: number, title: string, state: string): Locator =>
  steps(page).getByRole('listitem', { name: `${n}. ${title}: ${state}`, exact: true })

/** Gatilho de um Selector da Astryx (`button` sem valor, `combobox` com valor). */
function selector(scope: Locator, label: string): Locator {
  const name = new RegExp(`^${label}( |$)`)
  return scope.getByRole('combobox', { name }).or(scope.getByRole('button', { name }))
}

async function choose(page: Page, scope: Locator, label: string, option: string): Promise<void> {
  await selector(scope, label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  const repo = join(work, 'orkio-desktop')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  git(repo, 'config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# e2e\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/orkio-desktop.git')
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('do zero à primeira tarefa, parando no meio e continuando pela lista lateral', async () => {
  orkio = await launchOrkio(userDataDir, { validTokens: [TOKEN] }, { startPage: 'setup' })
  const { app, page } = orkio

  // Sem projeto: abre nos Primeiros passos, com o GitHub como passo atual.
  await expect(step(page, 1, 'Entrar com GitHub', 'agora')).toBeVisible()
  await expect(page.getByTestId('setup-pending')).toHaveText(
    '5 passos faltam. Dá para parar e voltar depois.'
  )
  // Sem "Continuar sem GitHub": o projeto é verificado no GitHub.
  await expect(page.getByRole('button', { name: 'Continuar sem GitHub' })).toHaveCount(0)

  // GitHub pelo Device Flow (simulado: aprova na hora) e o Notion vira o atual.
  const login = page.getByRole('region', { name: 'Entrar no Orkio' })
  await login.getByRole('button', { name: 'Entrar com GitHub' }).click()
  await expect(step(page, 1, 'Entrar com GitHub', 'feito')).toBeVisible({ timeout: 15_000 })
  await expect(step(page, 2, 'Conectar o Notion', 'agora')).toBeVisible()

  // Notion por token; o Claude Code simulado já está instalado e logado: vai direto à pasta.
  const notion = page.getByRole('region', { name: 'Conectar o Notion' })
  await notion.getByRole('button', { name: 'Usar token' }).click()
  await notion.getByLabel('Token do Notion').fill(TOKEN)
  await notion.getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(step(page, 2, 'Conectar o Notion', 'feito')).toBeVisible()
  await expect(step(page, 3, 'Claude Code', 'feito')).toBeVisible()
  await expect(step(page, 4, 'Escolher a pasta do projeto', 'agora')).toBeVisible()

  // Pasta: o seletor é do main; o repositório é detectado.
  await queueFolderPicks(app, [join(work, 'orkio-desktop')])
  await page.getByRole('button', { name: 'Escolher pasta' }).click()
  const add = page.getByRole('region', { name: 'Adicionar projeto' })
  await add.getByRole('button', { name: 'Adicionar projeto' }).click()
  await expect(step(page, 5, 'Onde ficam suas tarefas no Notion', 'agora')).toBeVisible()

  // Bancos (sugestão pelos nomes) e vínculo do projeto com a página do Notion.
  const banks = page.getByRole('region', { name: 'Bancos do Notion' })
  await choose(page, banks, 'Banco de Projetos', 'Projetos')
  await banks.getByRole('button', { name: 'Continuar' }).click()
  await choose(page, banks, 'Banco de Tarefas', 'Tarefas')
  await banks.getByRole('button', { name: 'Continuar' }).click()
  await expect(selector(banks, 'Status')).toContainText('Status')
  await banks.getByRole('button', { name: 'Salvar' }).click()
  await page.getByRole('button', { name: 'Vincular ao Notion' }).click()
  const link = page.getByRole('group', { name: 'Vincular orkio-desktop ao Notion' })
  await expect(selector(link, 'Projeto do Notion')).toContainText('Orkio Desktop')
  await link.getByRole('button', { name: 'Vincular' }).click()
  await expect(step(page, 6, 'Montar o quadro', 'agora')).toBeVisible()
  await expect(page.getByTestId('setup-pending')).toHaveText(
    '1 passo falta. Dá para parar e voltar depois.'
  )

  // Parar aqui: o app mostra o que falta na lista lateral.
  await page.getByRole('button', { name: 'Fazer depois' }).click()
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  const resume = nav.getByRole('button', { name: 'Falta 1 passo · continuar' })
  await expect(resume).toBeVisible()
  await resume.click()

  // Continuar configuração: passos já feitos marcados, atual = o quadro.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Continuar configuração' })
  ).toBeVisible()
  await expect(step(page, 6, 'Montar o quadro', 'agora')).toBeVisible()
  await page
    .getByRole('region', { name: 'Montar o quadro' })
    .getByRole('button', { name: 'Criar quadro' })
    .click()

  // Última etapa: as tarefas da pessoa; clicar abre a tela da tarefa.
  await expect(step(page, 7, 'Abrir a primeira tarefa', 'agora')).toBeVisible()
  await expect(page.getByTestId('setup-pending')).toHaveText('Tudo pronto.')
  const tasks = page.getByRole('list', { name: 'Suas tarefas' })
  await tasks.getByRole('listitem').filter({ hasText: 'ORK-2' }).click()
  await expect(taskScreen(page, 'ORK-2')).toBeVisible()
  await expect(nav.getByRole('button', { name: /^Falta / })).toHaveCount(0)
  expect(await cspViolations(page)).toEqual([])
})
