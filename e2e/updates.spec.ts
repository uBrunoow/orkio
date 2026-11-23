import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NOTION_FAKE,
  createUserDataDir,
  cspViolations,
  launchOrkio,
  taskScreen,
  navTo,
  openSettings,
  removeDir,
  simulateUpdate,
  updateInstalls,
  type OrkioApp
} from './fixtures'

/**
 * Etapa 6C com o autoUpdater SIMULADO (fixture `simulateUpdate`) e o Claude Code simulado:
 * banner, Configurações > Atualizações, "Atualizar quando terminar" e "O que há de novo".
 */
// A versão muda a cada release (o commit de versão mexe no package.json): nada de número fixo, ou
// o CI do próprio Release reprova assim que a versão sobe.
const APP_VERSION = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
).version
const NOTION_TOKEN = 'ntn_E2E_UPDATES_TOKEN_abcdef123456'
const ORK2 = 'ORK-2 Listar tarefas do Notion'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const configFile = (): string => join(userDataDir, 'orkio-config.json')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}
async function open(): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, { validTokens: [NOTION_TOKEN] })
  return orkio
}
async function close(): Promise<void> {
  if (!orkio) return
  await orkio.app.close()
  orkio = null
}
async function goTo(page: Page, name: 'Quadro' | 'Atualizações'): Promise<void> {
  await navTo(page, name)
}
function banner(page: Page): Locator {
  return page.getByTestId('update-banner')
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
  work = realpathSync(createUserDataDir())
  mkdirSync(repoDir())
  git(repoDir(), 'init', '-q', '-b', 'main')
  git(repoDir(), 'config', 'user.email', 'e2e@example.com')
  git(repoDir(), 'config', 'user.name', 'E2E')
  writeFileSync(join(repoDir(), 'README.md'), '# e2e\n')
  git(repoDir(), 'add', '.')
  git(repoDir(), 'commit', '-q', '-m', 'init')
  const origin = join(work, 'origin.git')
  git(work, 'init', '-q', '--bare', '-b', 'main', origin)
  git(repoDir(), 'remote', 'add', 'origin', origin)
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
          assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
        },
        updatedAt: '2026-11-19T00:00:00.000Z'
      },
      projects: [
        {
          id: 'proj-upd',
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

test('Configurações: versão, canal e "Procurar atualizações"; banner com a atualização pronta', async () => {
  const { app, page } = await open()
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
  await expect(page.getByRole('listitem', { name: ORK2, exact: true })).toBeVisible()

  // Sem empacotar, as atualizações ficam desligadas (e nenhum banner aparece).
  await goTo(page, 'Atualizações')
  const updates = page.getByRole('region', { name: 'Atualizações' })
  await expect(updates.getByTestId('current-version')).toHaveText(APP_VERSION)
  await expect(updates.getByTestId('update-status')).toContainText('só no app instalado')
  await expect(updates.getByRole('button', { name: 'Procurar atualizações' })).toBeDisabled()
  await expect(banner(page)).toHaveCount(0)
  // Sobre: versão; o build do E2E não tem site https de verdade, mas o intermediário é https.
  await openSettings(page, 'Sobre e diagnóstico')
  await expect(page.getByRole('region', { name: 'Sobre' })).toContainText(APP_VERSION)
  await openSettings(page, 'Atualizações')

  await simulateUpdate(app, { version: '9.9.9' })
  await updates.getByRole('button', { name: 'Procurar atualizações' }).click()
  await expect(banner(page)).toContainText('Atualização 9.9.9 pronta')
  await expect(updates.getByTestId('update-status')).toContainText('9.9.9 está pronta')
  await expect(updates.getByTestId('last-check')).not.toHaveText('Nunca')

  // Canal Beta é gravado na config (e volta).
  await updates.getByRole('radio', { name: 'Beta' }).click()
  await expect(updates).toContainText('versões de teste')
  await expect
    .poll(() => JSON.parse(readFileSync(configFile(), 'utf8')).updates.channel)
    .toBe('beta')
  await updates.getByRole('radio', { name: 'Estável' }).click()
  await expect
    .poll(() => JSON.parse(readFileSync(configFile(), 'utf8')).updates.channel)
    .toBe('stable')

  // "Agora não" esconde o banner nesta sessão.
  await banner(page).getByRole('button', { name: 'Agora não' }).click()
  await expect(banner(page)).toHaveCount(0)
  expect(await cspViolations(page)).toEqual([])
})

test('"Atualizar quando terminar" espera a execução do Claude acabar', async () => {
  await close()
  const { app, page } = await open()
  await simulateUpdate(app, { version: '9.9.9' })
  await goTo(page, 'Atualizações')
  await page
    .getByRole('region', { name: 'Atualizações' })
    .getByRole('button', { name: 'Procurar atualizações' })
    .click()
  await expect(banner(page)).toContainText('Atualização 9.9.9 pronta')

  // Uma execução longa do Claude Code.
  await goTo(page, 'Quadro')
  await page.getByRole('listitem', { name: ORK2, exact: true }).click()
  const section = taskScreen(page, 'ORK-2').getByRole('region', { name: 'Sessão da tarefa' })
  await section.getByRole('textbox', { name: 'Mensagem para o Claude Code' }).fill('demorar')
  await section.getByRole('button', { name: 'Enviar' }).click()
  const run = section.getByTestId('session-run').last()
  await expect(run.getByRole('list', { name: 'Log da execução' })).toContainText(
    'Trabalhando por um bom tempo'
  )

  // Reiniciar agora cancelaria a execução: o botão mostra o que está rodando.
  await banner(page).getByRole('button', { name: 'Reiniciar e atualizar' }).click()
  const running = banner(page).getByRole('list', { name: 'O que está rodando' })
  await expect(running).toContainText('Claude Code rodando em ORK-2')
  await banner(page).getByRole('button', { name: 'Atualizar quando terminar' }).click()
  await expect(banner(page)).toContainText('Vai reiniciar e atualizar assim que tudo terminar')
  await page.waitForTimeout(7_000)
  expect(await updateInstalls(app)).toBe(0)
  await expect(run.getByTestId('run-status')).not.toHaveText('Cancelada')

  // A execução termina → instala sozinho (depois de alguns segundos ocioso).
  await section.getByRole('button', { name: 'Parar' }).click()
  await expect(run.getByTestId('run-status')).toHaveText('Cancelada', { timeout: 20_000 })
  await expect.poll(() => updateInstalls(app), { timeout: 20_000 }).toBe(1)
  expect(await cspViolations(page)).toEqual([])
})

test('"O que há de novo" aparece uma vez depois de atualizar', async () => {
  await close()
  // Simula ter vindo de uma versão anterior.
  const config = JSON.parse(readFileSync(configFile(), 'utf8'))
  config.updates.lastSeenVersion = '0.0.1'
  writeFileSync(configFile(), JSON.stringify(config))

  let { page } = await open()
  const panel = page.getByRole('region', { name: `O que há de novo na versão ${APP_VERSION}` })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Entendi' }).click()
  await expect(panel).toHaveCount(0)
  expect(JSON.parse(readFileSync(configFile(), 'utf8')).updates.lastSeenVersion).toBe(APP_VERSION)

  await close()
  ;({ page } = await open())
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
  await expect(page.getByRole('region', { name: /O que há de novo/ })).toHaveCount(0)
})
