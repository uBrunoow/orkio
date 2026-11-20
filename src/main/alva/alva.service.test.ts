import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseBacklogTask, sizeFromSpecResult, taskFileId } from '../../shared/alva'
import { openDatabase, type Db } from '../db/database'
import type { ExtractContext } from '../flows/flow-runner'
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
  stepId: 's',
  command,
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

  it('/spec NÃO cria task: o passo falha com explicação', async () => {
    const r = await runStep('alva-flow:spec', '', async () => undefined)
    expect(r).toEqual({ fail: ALVA_MESSAGES.noTaskCreated })
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
