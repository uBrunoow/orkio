import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  FAKE_REPO,
  launchOrkio,
  removeDir,
  seedConfig,
  type OrkioApp
} from './fixtures'

/**
 * Fase 3 — Agentes: o editor novo (Simples com "Começar de" e a prévia ao vivo do card; Avançado
 * com a autonomia em cartões) e a tela Agentes › Memória (sugestão do estado vazio, adicionar,
 * editar, arquivar, apagar e voltar uma versão pelo histórico).
 */
const PROJECT = 'proj-memory'

test.describe.configure({ mode: 'serial' })

let userDataDir: string
let work: string
let orkio: OrkioApp | null = null
const repoDir = (): string => join(work, 'orkio-app')
const agentFile = (): string => join(repoDir(), '.orkio', 'agents', 'bia.md')
const memoryFile = (): string =>
  join(userDataDir, 'agent-memory', 'repo', PROJECT, 'bia', 'MEMORY.md')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString()
}

async function goToAgents(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Agentes' })
    .click()
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
  seedConfig(userDataDir, { id: PROJECT, name: 'orkio-app', localPath: repoDir(), repo: FAKE_REPO })
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  removeDir(userDataDir)
  removeDir(work)
})

test('cria um agente pelo Simples com "Começar de" e a prévia ao vivo; autonomia no Avançado', async () => {
  orkio = await launchOrkio(userDataDir, {}, { startPage: 'projects' })
  const { page } = orkio
  await goToAgents(page)
  const region = page.getByRole('region', { name: 'Agentes' })
  await page.getByRole('button', { name: 'Novo agente' }).click()
  const form = page.getByRole('form', { name: 'Novo agente' })
  const preview = form.getByRole('group', { name: /^Prévia do card/ })

  await form.getByRole('textbox', { name: /^Nome \(obrigatório\)/ }).fill('Bia')
  await expect(preview).toContainText('Bia')
  await form.getByRole('button', { name: 'Começar de: Revisar código' }).click()
  await expect(form.getByRole('textbox', { name: /^Instruções/ })).toHaveValue(
    /Você revisa o que foi feito/
  )
  // "O que faz?" vazio ganha a frase do modelo; a prévia acompanha.
  await expect(form.getByRole('textbox', { name: /^O que faz\?/ })).toHaveValue(
    /Revisa o diff da tarefa/
  )
  await expect(preview).toContainText('Revisa o diff da tarefa')
  await form.getByRole('textbox', { name: /^O que faz\?/ }).fill('Revisa o código e aponta riscos.')
  await expect(preview).toContainText('Revisa o código e aponta riscos.')
  await form.getByRole('radio', { name: 'Azul', exact: true }).click()
  await expect(form.getByRole('radio', { name: 'Azul', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )

  // Avançado: o modelo "Revisar código" escolheu "Só lê"; trocamos para "Pede antes de agir".
  await form.getByRole('radio', { name: 'Avançado' }).click()
  const autonomy = form.getByRole('radiogroup', { name: 'O que ele pode fazer sozinho?' })
  await expect(autonomy.getByRole('radio', { name: /^Só lê/ })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await autonomy.getByRole('radio', { name: /^Pede antes de agir/ }).click()
  await form.getByRole('textbox', { name: /^Grupo/ }).fill('Qualidade/Revisão')
  await expect(preview).toContainText('Qualidade › Revisao')
  await form.getByRole('button', { name: 'Salvar agente' }).click()
  await expect(region.getByText('Perfil salvo em .orkio/agents/bia.md')).toBeVisible()

  const file = readFileSync(agentFile(), 'utf8')
  expect(file).toContain('description: "Revisa o código e aponta riscos."')
  expect(file).toContain('group: "qualidade/revisao"')
  expect(file).toContain('autonomy: ask')
  expect(file).toContain('color: blue')

  const bia = region.getByRole('listitem', { name: 'Bia' })
  await expect(bia.getByTestId('agent-description')).toHaveText('Revisa o código e aponta riscos.')
  expect(await cspViolations(page)).toEqual([])
})

test('Agentes › Memória: sugestão, adicionar, editar, arquivar, apagar e voltar uma versão', async () => {
  const { page } = orkio!
  const region = page.getByRole('region', { name: 'Agentes' })
  await region.getByRole('button', { name: 'Memória de Bia' }).click()
  const memory = page.getByRole('region', { name: 'Memória de Bia' })
  await expect(memory).toContainText('Nenhuma nota ainda.')

  // Estado vazio = ponto de partida: a sugestão vira nota com um clique.
  await memory
    .getByRole('group', { name: 'Sugestões de nota' })
    .getByRole('button', { name: 'Mantenha as atualizações curtas e diretas.' })
    .click()
  const notes = memory.getByRole('list', { name: 'Notas' })
  await expect(notes).toContainText('Mantenha as atualizações curtas e diretas.')

  // Adicionar (Avançado: só neste projeto), com um segredo que some ao gravar.
  await memory.getByRole('button', { name: 'Adicionar nota' }).click()
  const add = memory.getByRole('form', { name: 'Nova nota' })
  await add
    .getByRole('textbox', { name: /^Nota/ })
    .fill('Use pnpm. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 nunca.')
  await add.getByRole('radio', { name: 'Avançado' }).click()
  await add.getByRole('radio', { name: /^Só neste projeto/ }).click()
  await add.getByRole('button', { name: 'Salvar nota' }).click()
  const pnpm = notes.getByRole('listitem', { name: /^Use pnpm/ })
  await expect(pnpm).toContainText('Só neste projeto')
  await expect(notes).not.toContainText('ghp_abcdefghij')
  expect(readFileSync(memoryFile(), 'utf8')).not.toContain('ghp_abcdefghij')
  await expect(memory.getByRole('meter', { name: 'Memória usada' })).toBeVisible()

  // Editar.
  await pnpm.getByRole('button', { name: 'Editar nota' }).click()
  const edit = memory.getByRole('form', { name: 'Editar nota' })
  await edit.getByRole('textbox', { name: /^Nota/ }).fill('Use pnpm, nunca npm.')
  await edit.getByRole('button', { name: 'Salvar nota' }).click()
  await expect(notes).toContainText('Use pnpm, nunca npm.')

  // Arquivar e apagar.
  await notes
    .getByRole('listitem', { name: /^Mantenha/ })
    .getByRole('button', { name: 'Arquivar' })
    .click()
  await expect(notes).not.toContainText('Mantenha')
  await notes
    .getByRole('listitem', { name: /^Use pnpm/ })
    .getByRole('button', { name: 'Apagar nota' })
    .click()
  await expect(memory.getByText('Nenhuma nota ainda.')).toBeVisible()

  // Avançado recolhido: arquivadas (restaurar) e histórico (voltar uma versão, com confirmação).
  await memory.getByRole('button', { name: /^Avançado/ }).click()
  await memory
    .getByRole('list', { name: 'Notas arquivadas' })
    .getByRole('button', { name: 'Restaurar' })
    .click()
  await expect(notes).toContainText('Mantenha as atualizações curtas e diretas.')
  const history = memory.getByRole('list', { name: 'Histórico da memória' })
  // A versão com "Use pnpm, nunca npm." e a nota sugerida: 2 notas.
  const twoNotes = history.getByRole('listitem').filter({ hasText: '2 nota(s)' }).first()
  await twoNotes.getByRole('button', { name: 'Voltar para esta versão' }).click()
  await twoNotes.getByRole('button', { name: 'Confirmar' }).click()
  await expect(notes).toContainText('Use pnpm, nunca npm.')

  await memory.getByRole('button', { name: 'Voltar para os agentes' }).click()
  await expect(region.getByRole('list', { name: 'Lista de agentes' })).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
})
