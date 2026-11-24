import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseBacklogTask, sizeFromSpecResult, taskFileId } from '../../shared/alva'
import { openDatabase, type Db } from '../db/database'
import type { ExtractContext } from '../flows/flow-runner'
import { ALVA_FAILURES, ALVA_OUTPUTS } from '../../shared/alva'
import { ALVA_MESSAGES, AlvaService } from './alva.service'

const task = (
  id: string,
  status: string,
  opts: { questions?: string[]; ac?: string[]; title?: string } = {}
): string => `---
id: ${id}
title: '${opts.title ?? 'Exportar CSV'}'
status: ${status}
assignee: []
labels: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problema
Tarefa no Notion: https://www.notion.so/ORK-2-bbbb2

## Perguntas em aberto
${(opts.questions ?? []).join('\n')}

## Decisões
- [ ] não conta (fora da seção)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
${(opts.ac ?? []).join('\n')}
<!-- AC:END -->
`

let wt: string
let db: Db
let service: AlvaService

const ctx = (command: string): ExtractContext => ({
  projectId: 'p1',
  taskId: 'notion-1',
  step: { id: 's', name: 'Passo', type: 'claude_command', command, args: '', timeoutMin: 5 },
  worktreePath: wt
})
const write = (file: string, body: string) => writeFile(join(wt, 'backlog', 'tasks', file), body)

beforeEach(async () => {
  wt = await mkdtemp(join(tmpdir(), 'orkio-alva-wt-'))
  await mkdir(join(wt, 'backlog', 'tasks'), { recursive: true })
  await write('task-1 - Antiga.md', task('TASK-1', 'Done', { title: 'Antiga' }))
  db = openDatabase(':memory:')
  service = new AlvaService({
    db,
    worktreePath: () => wt,
    projectDir: () => null,
    taskInfo: async () => ({
      displayId: 'ORK-2',
      title: 'Listar tarefas',
      url: 'https://www.notion.so/ORK-2-bbbb2'
    })
  })
})
afterEach(async () => {
  db.close()
  await rm(wt, { recursive: true, force: true })
})

async function runStep(command: string, resultText: string, change: () => Promise<void>) {
  const ex = service.extractor
  const snap = await ex.snapshot!(ctx(command))
  await change()
  return ex.extract({ resultText, ctx: ctx(command), snapshot: snap })
}

describe('alva-flow: vínculo e extratores', () => {
  it('parse da task: frontmatter, critérios e perguntas em aberto (só na seção)', () => {
    expect(
      parseBacklogTask(
        task('TASK-7', 'Requirements Defined', {
          questions: ['- [ ] Qual separador?', '- [x] Formato → CSV', '- [ ] Limite?'],
          ac: ['- [x] #1 CA-F01: gera', '- [ ] #2 CA-F02: baixa']
        })
      )
    ).toEqual({
      id: 'TASK-7',
      title: 'Exportar CSV',
      status: 'Requirements Defined',
      criteria: { done: 1, total: 2 },
      openQuestions: 2
    })
    expect(parseBacklogTask('# sem frontmatter')).toBeNull()
    expect(taskFileId('task-12 - Exportar-CSV.md')).toBe('task-12')
    expect(sizeFromSpecResult('## Spec pronta ✓\n**Tamanho:** Grande')).toBe('Grande')
    expect(sizeFromSpecResult('Pronto para commit')).toBeNull()
  })

  it('variáveis iniciais: sem vínculo, a descrição leva ID, título e a URL do Notion', async () => {
    expect(await service.initialVars('p1', 'notion-1')).toEqual({
      'alva.spec_arg':
        'ORK-2 — Listar tarefas. Tarefa no Notion: https://www.notion.so/ORK-2-bbbb2 Briefing completo em .orkio/briefing.md.',
      'alva.linked': 'nao'
    })
    service.setLink('p1', 'notion-1', 'TASK-9')
    expect(await service.initialVars('p1', 'notion-1')).toEqual({
      'alva.task_id': 'TASK-9',
      'alva.spec_arg': 'TASK-9',
      'alva.linked': 'sim'
    })
  })

  it('/spec cria UMA task: vincula e lê status, tamanho e perguntas', async () => {
    const r = await runStep('alva-flow:spec', 'Spec pronta\n**Tamanho:** Médio', () =>
      write(
        'task-2 - Listar-tarefas.md',
        task('TASK-2', 'Requirements Defined', { questions: ['- [ ] Paginação?'] })
      )
    )
    expect(r).toEqual({
      vars: {
        'alva.task_id': 'TASK-2',
        'alva.spec_arg': 'TASK-2',
        'alva.linked': 'sim',
        'alva.status': 'Requirements Defined',
        'alva.open_questions': '1',
        'alva.size': 'Médio'
      }
    })
    expect(service.getLink('notion-1')).toBe('TASK-2')
    // Só grava variáveis declaradas (as que o validador e os modelos conhecem).
    const declared = new Set(ALVA_OUTPUTS.map((o) => o.key))
    for (const key of Object.keys(r.vars ?? {})) expect(declared).toContain(key)
    expect(await service.taskSummary('p1', 'notion-1')).toMatchObject({ id: 'TASK-2' })
  })

  it('/spec no caminho Pequeno: status Reviewed vira tamanho Pequeno', async () => {
    const r = await runStep('alva-flow:spec', 'Pronto para commit ✓', () =>
      write('task-2 - X.md', task('TASK-2', 'Reviewed'))
    )
    expect(r.vars).toMatchObject({ 'alva.status': 'Reviewed', 'alva.size': 'Pequeno' })
  })

  it('/spec cria VÁRIAS: pede escolha; a escolha grava o vínculo', async () => {
    const r = await runStep('alva-flow:spec', '', async () => {
      await write('task-2 - A.md', task('TASK-2', 'Requirements Defined', { title: 'A' }))
      await write('task-3 - B.md', task('TASK-3', 'Requirements Defined', { title: 'B' }))
    })
    expect(r.choose).toEqual({
      prompt: ALVA_MESSAGES.choose,
      options: [
        { value: 'TASK-2', label: 'TASK-2 — A' },
        { value: 'TASK-3', label: 'TASK-3 — B' }
      ]
    })
    expect(service.getLink('notion-1')).toBeNull()
    const resolved = await service.extractor.resolveChoice!({
      ctx: ctx('alva-flow:spec'),
      value: 'TASK-3'
    })
    expect(resolved.vars).toMatchObject({
      'alva.task_id': 'TASK-3',
      'alva.status': 'Requirements Defined'
    })
    expect(service.getLink('notion-1')).toBe('TASK-3')
  })

  it('taskDocument: texto da task vinculada, sem marcadores e com segredos ocultados', async () => {
    service.setLink('p1', 'notion-1', 'TASK-2')
    await write(
      'task-2 - Listar-tarefas.md',
      task('TASK-2', 'Architected', {
        ac: ['- [ ] #1 CA-F01: gera'],
        questions: ['- [ ] Usar API_KEY=abc123segredo?']
      })
    )
    const doc = await service.taskDocument('p1', 'notion-1')
    expect(doc?.info).toMatchObject({ id: 'TASK-2', status: 'Architected' })
    expect(doc?.truncated).toBe(false)
    expect(doc?.body).toContain('- [ ] #1 CA-F01: gera')
    expect(doc?.body).not.toContain('<!--')
    expect(doc?.body).not.toContain('abc123segredo')
    expect(doc?.body).toContain('API_KEY=[omitido]')
  })

  it('taskDocument: sem vínculo ou sem o arquivo, devolve null', async () => {
    expect(await service.taskDocument('p1', 'notion-1')).toBeNull()
    service.setLink('p1', 'notion-1', 'TASK-99')
    expect(await service.taskDocument('p1', 'notion-1')).toBeNull()
  })

  it('taskDocument sem vínculo: o rascunho que o /spec está escrevendo no worktree', async () => {
    const project = await mkdtemp(join(tmpdir(), 'orkio-alva-proj-'))
    try {
      await mkdir(join(project, 'backlog', 'tasks'), { recursive: true })
      // A task-1 é igual na pasta do projeto: não é desta tarefa.
      await writeFile(
        join(project, 'backlog', 'tasks', 'task-1 - Antiga.md'),
        task('TASK-1', 'Done', { title: 'Antiga' })
      )
      const svc = new AlvaService({
        db,
        worktreePath: () => wt,
        projectDir: () => project,
        taskInfo: async () => null
      })
      expect(await svc.taskDocument('p1', 'notion-1')).toBeNull()
      await write(
        'task-7 - Pipeline.md',
        task('TASK-7', 'Requirements Defined', { title: 'Pipeline', ac: ['- [ ] #1 CA: roda'] })
      )
      const doc = await svc.taskDocument('p1', 'notion-1')
      expect(doc).toMatchObject({ draft: true, info: { id: 'TASK-7', title: 'Pipeline' } })
      expect(doc?.body).toContain('CA: roda')
      expect(await svc.taskSummary('p1', 'notion-1')).toMatchObject({ id: 'TASK-7' })
      // Vinculada, deixa de ser rascunho.
      svc.setLink('p1', 'notion-1', 'TASK-7')
      expect((await svc.taskDocument('p1', 'notion-1'))?.draft).toBeUndefined()
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  it('primeira rodada (sem worktree na hora da foto): compara com a pasta do projeto', async () => {
    // O worktree nasce no passo: antes dele, a foto vem da pasta do projeto (com as tasks antigas).
    const project = await mkdtemp(join(tmpdir(), 'orkio-alva-proj-'))
    const fresh = join(tmpdir(), `orkio-alva-novo-${Date.now()}`)
    try {
      await mkdir(join(project, 'backlog', 'tasks'), { recursive: true })
      for (const n of [1, 2, 3]) {
        await writeFile(
          join(project, 'backlog', 'tasks', `task-${n} - Velha-${n}.md`),
          task(`TASK-${n}`, 'Done', { title: `Velha ${n}` })
        )
      }
      const svc = new AlvaService({
        db,
        worktreePath: () => fresh,
        projectDir: () => project,
        taskInfo: async () => null
      })
      const c: ExtractContext = { ...ctx('alva-flow:spec'), worktreePath: fresh }
      const snap = await svc.extractor.snapshot!(c)
      // O passo cria o worktree (cópia da branch padrão) e escreve a task nova.
      await mkdir(join(fresh, 'backlog', 'tasks'), { recursive: true })
      for (const n of [1, 2, 3]) {
        await writeFile(
          join(fresh, 'backlog', 'tasks', `task-${n} - Velha-${n}.md`),
          task(`TASK-${n}`, 'Done', { title: `Velha ${n}` })
        )
      }
      await writeFile(
        join(fresh, 'backlog', 'tasks', 'task-4 - Nova.md'),
        task('TASK-4', 'Requirements Defined', { title: 'Nova' })
      )
      const r = await svc.extractor.extract({ resultText: '', ctx: c, snapshot: snap })
      expect(r.choose).toBeUndefined()
      expect(svc.getLink('notion-1')).toBe('TASK-4')
    } finally {
      await rm(project, { recursive: true, force: true })
      await rm(fresh, { recursive: true, force: true })
    }
  })

  it('/spec atualiza uma task que já existia no repositório: vincula a ela (não é "sem task")', async () => {
    // A task-38 já estava no git (de outra rodada ou de outra pessoa); o /spec a reescreve.
    await write('task-5 - Existente.md', task('TASK-5', 'To Do', { title: 'Existente' }))
    const r = await runStep('alva-flow:spec', '**Tamanho:** Médio', () =>
      write(
        'task-5 - Existente.md',
        task('TASK-5', 'Requirements Defined', { title: 'Existente', ac: ['- [ ] #1 CA-F01: x'] })
      )
    )
    expect(r.fail).toBeUndefined()
    expect(r.vars).toMatchObject({
      'alva.task_id': 'TASK-5',
      'alva.status': 'Requirements Defined',
      'alva.linked': 'sim'
    })
    expect(service.getLink('notion-1')).toBe('TASK-5')
  })

  it('/spec cria uma task nova e mexe em outra: a nova é a desta tarefa', async () => {
    await write('task-5 - Existente.md', task('TASK-5', 'To Do'))
    const r = await runStep('alva-flow:spec', '', async () => {
      await write('task-5 - Existente.md', task('TASK-5', 'To Do', { ac: ['- [ ] #1 vizinha'] }))
      await write('task-6 - Nova.md', task('TASK-6', 'Requirements Defined', { title: 'Nova' }))
    })
    expect(r.vars).toMatchObject({ 'alva.task_id': 'TASK-6' })
    expect(service.getLink('notion-1')).toBe('TASK-6')
  })

  it('/spec atualiza mais de uma task que já existia: pede a escolha', async () => {
    await write('task-5 - A.md', task('TASK-5', 'To Do', { title: 'A' }))
    await write('task-6 - B.md', task('TASK-6', 'To Do', { title: 'B' }))
    const r = await runStep('alva-flow:spec', '', async () => {
      await write('task-5 - A.md', task('TASK-5', 'Requirements Defined', { title: 'A' }))
      await write('task-6 - B.md', task('TASK-6', 'Requirements Defined', { title: 'B' }))
    })
    expect(r.choose).toEqual({
      prompt: ALVA_MESSAGES.chooseChanged,
      options: [
        { value: 'TASK-5', label: 'TASK-5 — A' },
        { value: 'TASK-6', label: 'TASK-6 — B' }
      ]
    })
    expect(service.getLink('notion-1')).toBeNull()
  })

  it('salvar uma task com o mesmo conteúdo não conta como alteração', async () => {
    await write('task-5 - Existente.md', task('TASK-5', 'To Do'))
    const r = await runStep('alva-flow:spec', '', () =>
      write('task-5 - Existente.md', task('TASK-5', 'To Do'))
    )
    expect(r).toEqual({
      fail: { code: ALVA_FAILURES.noTaskCreated, message: ALVA_MESSAGES.noTaskCreated }
    })
  })

  it('/spec NÃO cria task: o passo falha com explicação', async () => {
    const r = await runStep('alva-flow:spec', '', async () => undefined)
    expect(r).toEqual({
      fail: { code: ALVA_FAILURES.noTaskCreated, message: ALVA_MESSAGES.noTaskCreated }
    })
  })

  it('/review: Executed = blocker; Reviewed = limpo', async () => {
    service.setLink('p1', 'notion-1', 'TASK-2')
    await write('task-2 - X.md', task('TASK-2', 'Executed'))
    let r = await runStep('alva-flow:review', '', async () => undefined)
    expect(r.vars).toMatchObject({ 'alva.status': 'Executed', 'alva.review_blocker': 'sim' })
    r = await runStep('alva-flow:review', '', () =>
      write('task-2 - X.md', task('TASK-2', 'Reviewed'))
    )
    expect(r.vars).toMatchObject({ 'alva.review_blocker': 'nao' })
    // Outros comandos não mexem no blocker.
    r = await runStep('alva-flow:implement', '', async () => undefined)
    expect(r.vars?.['alva.review_blocker']).toBeUndefined()
  })
})
