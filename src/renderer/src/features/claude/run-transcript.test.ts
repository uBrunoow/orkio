import { describe, expect, it } from 'vitest'
import type { PermissionBlockCode, RunLogEvent } from '../../../../shared/agent-run'
import {
  buildTranscript,
  runningSubagents,
  categoryOf,
  failedLabel,
  summarizeSteps,
  type TranscriptItem,
  type WorkStep
} from './run-transcript'

const tool = (id: string, name: string, summary: string, file?: string): RunLogEvent => ({
  kind: 'tool',
  id,
  tool: name,
  summary,
  ...(file ? { file } : {})
})
const ok = (id: string): RunLogEvent => ({ kind: 'tool_result', id, error: false })
const bad = (id: string): RunLogEvent => ({ kind: 'tool_result', id, error: true })
const text = (t: string): RunLogEvent => ({ kind: 'text', text: t })
const step = (name: string, summary: string, file: string | null = null): WorkStep => ({
  id: `${name}:${summary}`,
  tool: name,
  summary,
  category: categoryOf(name),
  file,
  state: 'ok'
})

function kinds(items: TranscriptItem[]): string[] {
  return items.map((i) => i.kind)
}

describe('summarizeSteps', () => {
  it('conta comandos e arquivos distintos, em ordem fixa', () => {
    const s = summarizeSteps([
      step('Read', 'a.ts'),
      step('Bash', 'git status'),
      step('Edit', 'b.ts', 'b.ts'),
      step('Edit', 'b.ts', 'b.ts'),
      step('Read', 'a.ts'),
      step('Read', 'c.ts'),
      step('Bash', 'pnpm test')
    ])
    expect(s.label).toBe('Rodou 2 comandos · Editou 1 arquivo · Leu 2 arquivos')
    expect(s.failed).toBe(0)
  })

  it('buscas, subagentes e ferramentas', () => {
    expect(summarizeSteps([step('Grep', 'x')]).label).toBe('Buscou 1 vez')
    expect(summarizeSteps([step('Grep', 'x'), step('Glob', 'y')]).label).toBe('Buscou 2 vezes')
    expect(summarizeSteps([step('Task', 'revisar')]).label).toBe('Delegou a 1 subagente')
    expect(summarizeSteps([step('Skill', 'x'), step('TodoWrite', '')]).label).toBe(
      'Usou 2 ferramentas'
    )
  })

  it('conta falhas', () => {
    const failed: WorkStep = { ...step('Bash', 'npm test'), state: 'failed' }
    expect(summarizeSteps([failed, step('Bash', 'ls')]).failed).toBe(1)
    expect(failedLabel(1)).toBe('1 falhou')
    expect(failedLabel(3)).toBe('3 falharam')
  })
})

describe('buildTranscript', () => {
  it('agrupa ferramentas seguidas e separa por mensagens', () => {
    const items = buildTranscript(
      [
        { kind: 'init', model: 'claude-opus-5-5', plugins: [], commands: [] },
        text('Vou olhar o repositório.'),
        tool('1', 'Read', 'a.ts'),
        ok('1'),
        tool('2', 'Bash', 'git status'),
        ok('2'),
        text('Achei o problema.'),
        tool('3', 'Edit', 'a.ts', 'a.ts'),
        ok('3')
      ],
      false
    )
    expect(kinds(items)).toEqual(['started', 'message', 'work', 'message', 'work'])
    const first = items[2]
    expect(first?.kind === 'work' && first.steps.map((s) => s.state)).toEqual(['ok', 'ok'])
  })

  it('o resultado de uma ferramenta marca a falha pelo id, mesmo depois de outras linhas', () => {
    const items = buildTranscript([tool('1', 'Bash', 'git push'), text('Tentei.'), bad('1')], false)
    const work = items[0]
    expect(work?.kind === 'work' && work.steps[0]?.state).toBe('failed')
  })

  it('permissão aprovada entra no grupo; negada e bloqueada continuam visíveis', () => {
    const items = buildTranscript(
      [
        tool('1', 'Bash', 'pnpm test'),
        {
          kind: 'permission',
          requestId: 'p1',
          tool: 'Bash',
          summary: 'pnpm test',
          state: 'pending'
        },
        {
          kind: 'permission',
          requestId: 'p1',
          tool: 'Bash',
          summary: 'pnpm test',
          state: 'allowed'
        },
        ok('1'),
        tool('2', 'Bash', 'git push origin HEAD'),
        {
          kind: 'permission',
          requestId: 'p2',
          tool: 'Bash',
          summary: 'git push origin HEAD',
          state: 'blocked',
          reason: 'push é feito pelo Orkio'
        },
        bad('2')
      ],
      false
    )
    expect(kinds(items)).toEqual(['work', 'receipt'])
    const work = items[0]
    expect(work?.kind === 'work' && work.approvals).toBe(1)
    expect(items[1]).toMatchObject({
      kind: 'receipt',
      tone: 'problem',
      text: 'Bloqueado: git push origin HEAD (push é feito pelo Orkio)'
    })
  })

  it('recibo de push/gh bloqueado carrega a ação "Abrir PR" (pelo código); outros bloqueios não', () => {
    const blocked = (summary: string, code?: PermissionBlockCode): RunLogEvent => ({
      kind: 'permission',
      requestId: summary,
      tool: 'Bash',
      summary,
      state: 'blocked',
      // O texto não decide nada: o mesmo texto com outro código não oferece o botão.
      reason: 'Bloqueado pelo Orkio: git push só é permitido em um passo de fluxo.',
      ...(code ? { code } : {})
    })
    const items = buildTranscript(
      [
        blocked('git push origin HEAD', 'push'),
        blocked('gh pr create', 'gh'),
        blocked('cat /etc/x', 'outside'),
        blocked('git push --force', 'delivery'),
        blocked('git push antigo')
      ],
      false
    )
    expect(items.map((i) => (i.kind === 'receipt' ? (i.action ?? null) : 'x'))).toEqual([
      'open-pr',
      'open-pr',
      null,
      null,
      null
    ])
  })

  it('pedidos pendentes não aparecem (têm cartão próprio)', () => {
    const items = buildTranscript(
      [
        {
          kind: 'question',
          requestId: 'q1',
          questions: [
            { question: 'Ponto e vírgula?', options: ['Sim', 'Não'], multiSelect: false }
          ],
          state: 'pending'
        }
      ],
      true
    )
    expect(items).toEqual([])
  })

  it('recibos iguais em sequência viram um com contagem', () => {
    const items = buildTranscript(
      [
        { kind: 'info', text: 'Hook do projeto rodou: format' },
        { kind: 'info', text: 'Hook do projeto rodou: format' },
        { kind: 'info', text: 'Hook do projeto rodou: format' }
      ],
      false
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'receipt', count: 3 })
  })

  it('fila e rodando somem; falha e cancelamento viram aviso', () => {
    const items = buildTranscript(
      [
        { kind: 'status', status: 'queued' },
        { kind: 'status', status: 'running' },
        { kind: 'status', status: 'failed', message: 'O Claude Code terminou com erro.' },
        { kind: 'status', status: 'cancelled' }
      ],
      false
    )
    expect(items).toEqual([
      { kind: 'notice', key: 'e2', tone: 'danger', text: 'O Claude Code terminou com erro.' },
      { kind: 'notice', key: 'e3', tone: 'neutral', text: 'Execução cancelada.' }
    ])
  })

  it('o resultado não repete a última mensagem, mas mostra o erro', () => {
    const same = buildTranscript(
      [
        text('Pronto: 3 arquivos.'),
        {
          kind: 'result',
          ok: true,
          durationMs: 1000,
          costUsd: 0.1,
          turns: 2,
          text: 'Pronto:  3 arquivos.'
        }
      ],
      false
    )
    expect(same[1]).toMatchObject({ kind: 'result', ok: true, text: '', turns: 2 })

    const different = buildTranscript(
      [
        text('Terminei.'),
        {
          kind: 'result',
          ok: true,
          durationMs: null,
          costUsd: null,
          turns: 1,
          text: 'Resumo final'
        }
      ],
      false
    )
    expect(different[1]).toMatchObject({ text: 'Resumo final' })

    const failed = buildTranscript(
      [
        text('Erro ao rodar.'),
        {
          kind: 'result',
          ok: false,
          durationMs: null,
          costUsd: null,
          turns: null,
          text: 'Erro ao rodar.'
        }
      ],
      false
    )
    expect(failed[1]).toMatchObject({ ok: false, text: 'Erro ao rodar.' })
  })

  it('só o último grupo de uma execução ao vivo fica "live"; fora dela nada fica rodando', () => {
    const events: RunLogEvent[] = [tool('1', 'Bash', 'sleep 5')]
    const live = buildTranscript(events, true)
    expect(live[0]).toMatchObject({ kind: 'work', live: true })
    const done = buildTranscript(events, false)
    expect(done[0]).toMatchObject({ kind: 'work', live: false })
    expect(done[0]?.kind === 'work' && done[0].steps[0]?.state).toBe('ok')
  })
})

describe('subagentes', () => {
  const sub = (id: string, title: string, background = false): RunLogEvent => ({
    kind: 'subagent',
    id,
    title,
    agentType: 'review-agent',
    background,
    at: '2026-11-23T10:00:00.000Z'
  })
  const child = (id: string, parent: string): RunLogEvent => ({
    kind: 'tool',
    id,
    tool: 'Read',
    summary: 'a.ts',
    parent
  })

  it('agrupa subagentes seguidos e conta as ferramentas de cada um', () => {
    const events: RunLogEvent[] = [
      tool('A', 'Task', 'Revisar API'),
      sub('A', 'Revisar API'),
      tool('B', 'Task', 'Escrever testes'),
      sub('B', 'Escrever testes'),
      child('c1', 'A'),
      child('c2', 'A'),
      child('c3', 'B'),
      ok('A')
    ]
    const items = buildTranscript(events, true)
    expect(kinds(items)).toEqual(['subagents'])
    const g = items[0]
    expect(g?.kind === 'subagents' && g.agents.map((a) => [a.state, a.tools])).toEqual([
      ['done', 2],
      ['running', 1]
    ])
    expect(runningSubagents(items).map((a) => a.title)).toEqual(['Escrever testes'])
    expect(runningSubagents(buildTranscript(events, false))).toEqual([])
  })

  it('segundo plano, falha e texto entre lançamentos', () => {
    const items = buildTranscript(
      [sub('A', 'x', true), ok('A'), sub('B', 'y'), bad('B'), text('ok'), sub('C', 'z')],
      true
    )
    expect(kinds(items)).toEqual(['subagents', 'message', 'subagents'])
    const g = items[0]
    expect(g?.kind === 'subagents' && g.agents.map((a) => a.state)).toEqual([
      'background',
      'failed'
    ])
  })

  it('execução cancelada/falha com subagente pendente: interrompido, não concluído', () => {
    const events: RunLogEvent[] = [sub('A', 'x'), sub('B', 'y'), ok('A')]
    for (const status of ['cancelled', 'failed'] as const) {
      const g = buildTranscript(events, false, status)[0]
      expect(g?.kind === 'subagents' && g.agents.map((a) => a.state)).toEqual([
        'done',
        'interrupted'
      ])
    }
    const done = buildTranscript(events, false, 'succeeded')[0]
    expect(done?.kind === 'subagents' && done.agents.map((a) => a.state)).toEqual(['done', 'done'])
  })

  it('log antigo (Task sem evento subagent) continua um passo de delegação', () => {
    const items = buildTranscript([tool('A', 'Task', 'Revisar API'), ok('A')], false)
    expect(kinds(items)).toEqual(['work'])
  })
})
