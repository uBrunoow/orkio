import { describe, expect, it } from 'vitest'
import {
  agentIdFromName,
  agentInitials,
  buildAgentPrompt,
  checkAgentFlow,
  defaultAgent,
  parseAgentFile,
  parseAgentKey,
  serializeAgent,
  validateAgent,
  type AgentProfile
} from './agent'
import type { Flow } from './task-flow'
import { builtinAgent } from './agent-presets'
import { alvaReviewPublishFlow } from './alva-templates'

const ANA: AgentProfile = defaultAgent({
  id: 'ana',
  name: 'Ana',
  role: 'implementer',
  color: 'orange',
  model: 'sonnet',
  flow: 'alva-implementar',
  commands: ['alva-flow:spec', 'alva-flow:implement'],
  delivery: true,
  limits: { parallel: 1, stepsPerDay: 40, costPerDayUsd: 5.5 },
  instructions:
    'Você implementa tarefas.\n\n- Testes sempre.\n- Nunca mexa em migrations sem perguntar.'
})

const FILE = `---
orkio: agent/v1
id: ana
name: Ana
role: implementer
color: orange
model: sonnet
flow: alva-implementar   # comentário
commands: [alva-flow:spec, "alva-flow:implement"]
delivery: true
limits:
  parallel: 1
  stepsPerDay: 40
  costPerDayUsd: 5.5
---
Você implementa tarefas.

- Testes sempre.
- Nunca mexa em migrations sem perguntar.
`

describe('parseAgentFile', () => {
  it('lê o formato documentado', () => {
    const r = parseAgentFile(FILE)
    expect(r).toEqual({ ok: true, profile: ANA, warnings: [] })
  })

  it('volta igual depois de gravar (serializeAgent)', () => {
    const r = parseAgentFile(serializeAgent(ANA))
    expect(r.ok && r.profile).toEqual(ANA)
    const archived = { ...ANA, archived: true, flow: null, commands: [] }
    const r2 = parseAgentFile(serializeAgent(archived))
    expect(r2.ok && r2.profile).toEqual(archived)
  })

  it('nome com aspas, dois-pontos e acentos sobrevive ao arquivo', () => {
    const p = { ...ANA, name: 'João: "o revisor"' }
    const r = parseAgentFile(serializeAgent(p))
    expect(r.ok && r.profile.name).toBe('João: "o revisor"')
  })

  it('aceita CRLF e BOM', () => {
    const r = parseAgentFile(`\uFEFF${FILE.replace(/\n/g, '\r\n')}`)
    expect(r.ok).toBe(true)
  })

  it('campos desconhecidos viram aviso e são ignorados', () => {
    const r = parseAgentFile(FILE.replace('delivery: true', 'delivery: true\nperigo: sim'))
    expect(r.ok && r.warnings).toEqual(['Campo desconhecido ignorado: perigo.'])
    expect(r.ok && 'perigo' in r.profile).toBe(false)
  })

  it('recusa arquivo sem cabeçalho, formato errado ou maior que 16 KB', () => {
    expect(parseAgentFile('só texto').ok).toBe(false)
    expect(parseAgentFile(FILE.replace('agent/v1', 'agent/v2')).ok).toBe(false)
    const big = `${FILE}${'x'.repeat(17 * 1024)}`
    expect(parseAgentFile(big)).toEqual({
      ok: false,
      errors: ['O arquivo do agente passa de 16 KB.']
    })
  })

  it('recusa truques de YAML (âncoras, tags, mapas inline, blocos)', () => {
    for (const bad of ['name: &a Ana', 'name: !!python/object x', 'name: {a: 1}', 'name: |']) {
      const r = parseAgentFile(FILE.replace('name: Ana', bad))
      expect(r.ok, bad).toBe(false)
    }
  })

  it('recusa campo repetido e linha estranha', () => {
    expect(parseAgentFile(FILE.replace('role: implementer', 'role: implementer\nid: bob')).ok).toBe(
      false
    )
    expect(parseAgentFile(FILE.replace('role: implementer', '- item')).ok).toBe(false)
  })

  it('valida tipos e limites', () => {
    const cases: [string, string][] = [
      ['id: ana', 'id: Ana Maria'],
      ['role: implementer', 'role: hacker'],
      ['model: sonnet', 'model: GPT-4'],
      ['delivery: true', 'delivery: sim'],
      ['  parallel: 1', '  parallel: 50'],
      ['  stepsPerDay: 40', '  stepsPerDay: 0'],
      ['  costPerDayUsd: 5.5', '  costPerDayUsd: -1'],
      ['commands: [alva-flow:spec, "alva-flow:implement"]', 'commands: ["rm -rf /"]'],
      ['commands: [alva-flow:spec, "alva-flow:implement"]', 'commands: tudo'],
      ['color: orange', 'color: "#ff0000"']
    ]
    for (const [from, to] of cases) {
      const r = parseAgentFile(FILE.replace(from, to))
      expect(r.ok, to).toBe(false)
    }
  })

  it('instruções longas demais ou com "---" são recusadas', () => {
    expect(validateAgent({ ...ANA, instructions: 'x'.repeat(8_001) })).toHaveLength(1)
    expect(validateAgent({ ...ANA, instructions: 'a\n---\nb' })).toHaveLength(1)
  })
})

describe('chaves, iniciais e id', () => {
  it('parseAgentKey', () => {
    expect(parseAgentKey('repo:ana')).toEqual({ scope: 'repo', id: 'ana' })
    expect(parseAgentKey('local:bob-2')).toEqual({ scope: 'local', id: 'bob-2' })
    expect(parseAgentKey('outro:ana')).toBeNull()
    expect(parseAgentKey('repo:../x')).toBeNull()
    expect(parseAgentKey(42)).toBeNull()
  })

  it('agentInitials e agentIdFromName', () => {
    expect(agentInitials('Ana')).toBe('AN')
    expect(agentInitials('Ana Souza Lima')).toBe('AL')
    expect(agentIdFromName('João, o Revisor!')).toBe('joao-o-revisor')
  })
})

describe('buildAgentPrompt', () => {
  it('traz quem é, as regras e as instruções (sem briefing)', () => {
    const text = buildAgentPrompt(ANA)
    expect(text).toContain('Você é Ana (implementador(a))')
    expect(text).toContain('Regras do Orkio')
    expect(text).toContain('Nunca mexa em migrations sem perguntar.')
    expect(text).not.toContain('Briefing')
  })
})

describe('checkAgentFlow', () => {
  const flow: Flow = {
    id: 'f',
    name: 'Entregar',
    steps: [
      {
        id: 'a',
        name: 'Implementar',
        type: 'claude_command',
        command: 'alva-flow:implement',
        args: '',
        timeoutMin: 30
      },
      { id: 'b', name: 'Push', type: 'orkio_action', action: 'push' }
    ]
  } as Flow

  it('sem entrega: fluxo com push é recusado', () => {
    expect(checkAgentFlow({ ...ANA, delivery: false }, flow)).toMatch(/não pode entregar/)
    expect(checkAgentFlow(ANA, flow)).toBeNull()
  })

  it('passo em modo entrega também conta', () => {
    const f = {
      ...flow,
      steps: [{ ...flow.steps[0]!, delivery: true }]
    } as Flow
    expect(checkAgentFlow({ ...ANA, delivery: false }, f)).toMatch(/Implementar/)
  })

  it('comando fora da lista é recusado; lista vazia libera todos', () => {
    expect(checkAgentFlow({ ...ANA, commands: ['alva-flow:spec'] }, flow)).toMatch(
      /alva-flow:implement/
    )
    expect(checkAgentFlow({ ...ANA, commands: [] }, flow)).toBeNull()
  })

  it('Revisor embutido (sem entrega) roda a "revisão publicada": publish_review não é entrega', () => {
    const revisor = builtinAgent('revisor')!
    expect(revisor.delivery).toBe(false)
    expect(checkAgentFlow(revisor, alvaReviewPublishFlow())).toBeNull()
    // O mesmo agente continua barrado num fluxo que entrega.
    expect(checkAgentFlow(revisor, flow)).toMatch(/não pode entregar/)
  })
})

describe('modelo livre e raciocínio', () => {
  const withKeys = (model: string, effort?: string): string =>
    FILE.replace('model: sonnet', `model: ${model}${effort ? `\neffort: ${effort}` : ''}`)

  it('lê e grava model e effort', () => {
    const r = parseAgentFile(withKeys('claude-opus-5-5', 'high'))
    expect(r.ok && r.profile.model).toBe('claude-opus-5-5')
    expect(r.ok && r.profile.effort).toBe('high')
    const text = serializeAgent(r.ok ? r.profile : ANA)
    expect(text).toContain('model: claude-opus-5-5\n')
    expect(text).toContain('effort: high\n')
  })

  it('perfil antigo: effort nulo e nenhuma linha effort ao gravar', () => {
    const r = parseAgentFile(FILE)
    expect(r.ok && r.profile.effort).toBeNull()
    expect(serializeAgent(ANA)).not.toContain('effort')
  })

  it('recusa modelo e raciocínio inválidos', () => {
    const m = parseAgentFile(withKeys('"--x"'))
    expect(!m.ok && m.errors).toContain('Modelo inválido')
    const e = parseAgentFile(withKeys('sonnet', 'ultra'))
    expect(!e.ok && e.errors).toContain('Raciocínio inválido')
  })
})
