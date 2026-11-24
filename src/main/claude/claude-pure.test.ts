import { describe, expect, it } from 'vitest'
import { blocksToMarkdown, buildBriefing, extractAcceptanceCriteria } from '../../shared/briefing'
import {
  POLICY_MESSAGES,
  evaluatePermission,
  isInside,
  shellSegments,
  suggestPattern
} from './policy'
import { isEnvFile, redactSecrets, sanitizeEnv } from './redact'
import { parseStreamLine } from './stream'

const WT = '/home/u/.config/orkio/worktrees/p1/ORK-7'
const rt = (
  text: string,
  annotations: Record<string, boolean> = {},
  href: string | null = null
) => [{ plain_text: text, annotations, href }]

describe('stream-json → uso do contexto', () => {
  const line = (over: Record<string, unknown>): string =>
    JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'text', text: 'oi' }],
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 80000,
          cache_creation_input_tokens: 1000,
          output_tokens: 7
        }
      },
      ...over
    })
  it('emite o uso da mensagem principal com a janela do modelo', () => {
    expect(parseStreamLine(line({}), WT)[0]).toEqual({
      kind: 'usage',
      inputTokens: 82_000,
      contextWindow: 200_000
    })
    expect(parseStreamLine(line({}), WT, undefined, 'claude-opus[1m]')[0]).toEqual({
      kind: 'usage',
      inputTokens: 82_000,
      contextWindow: 1_000_000
    })
  })
  it('mensagem de subagente e linha sem usage não emitem uso', () => {
    expect(
      parseStreamLine(line({ parent_tool_use_id: 'toolu_1' }), WT).some((e) => e.kind === 'usage')
    ).toBe(false)
    const none = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'oi' }] }
    })
    expect(parseStreamLine(none, WT)).toEqual([{ kind: 'text', text: 'oi' }])
  })
})

describe('stream-json → log', () => {
  it('init, texto, ferramenta, resultado de ferramenta e resultado final', () => {
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          model: 'claude-x',
          plugins: [{ name: 'alva-flow', path: '/p' }],
          slash_commands: ['spec', 'plan']
        }),
        WT
      )
    ).toEqual([
      { kind: 'init', model: 'claude-x', plugins: ['alva-flow'], commands: ['spec', 'plan'] }
    ])

    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'text', text: 'Vou ajustar o arquivo.' },
              {
                type: 'tool_use',
                id: 't1',
                name: 'Edit',
                input: { file_path: `${WT}/src/a.ts`, old_string: 'x' }
              },
              {
                type: 'tool_use',
                id: 't2',
                name: 'Bash',
                input: { command: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123 npm test' }
              }
            ]
          }
        }),
        WT
      )
    ).toEqual([
      { kind: 'text', text: 'Vou ajustar o arquivo.' },
      { kind: 'tool', id: 't1', tool: 'Edit', summary: 'src/a.ts', file: 'src/a.ts' },
      { kind: 'tool', id: 't2', tool: 'Bash', summary: 'GITHUB_TOKEN=[omitido] npm test' }
    ])

    // Conteúdo do resultado (ex.: um .env lido) nunca entra no log: só se deu erro.
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't3',
                content: 'API_KEY=supersecret',
                is_error: false
              }
            ]
          }
        }),
        WT
      )
    ).toEqual([{ kind: 'tool_result', id: 't3', error: false }])

    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 1234,
          total_cost_usd: 0.42,
          num_turns: 5,
          result: 'Pronto.'
        }),
        WT
      )
    ).toEqual([
      { kind: 'result', ok: true, durationMs: 1234, costUsd: 0.42, turns: 5, text: 'Pronto.' }
    ])
  })

  it('subagentes: parent nas ferramentas filhas e evento subagent para Task/Agent', () => {
    const line = (parent: string | null, block: unknown): string =>
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: parent,
        message: { content: [block] }
      })
    const now = (): Date => new Date('2026-11-23T10:00:00.000Z')
    expect(
      parseStreamLine(
        line('t1', { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.ts' } }),
        WT,
        now
      )
    ).toEqual([{ kind: 'tool', id: 'r1', tool: 'Read', summary: 'a.ts', parent: 't1' }])
    expect(
      parseStreamLine(
        line(null, {
          type: 'tool_use',
          id: 't1',
          name: 'Task',
          input: { description: 'Revisar API', subagent_type: 'review-agent', prompt: 'x' }
        }),
        WT,
        now
      )
    ).toEqual([
      { kind: 'tool', id: 't1', tool: 'Task', summary: 'Revisar API' },
      {
        kind: 'subagent',
        id: 't1',
        title: 'Revisar API',
        agentType: 'review-agent',
        background: false,
        at: '2026-11-23T10:00:00.000Z'
      }
    ])
    const bg = parseStreamLine(
      line(null, {
        type: 'tool_use',
        id: 't2',
        name: 'Agent',
        input: { description: 'Longo', run_in_background: true }
      }),
      WT,
      now
    )
    expect(bg[1]).toMatchObject({ kind: 'subagent', background: true, agentType: null })
  })

  it('subagente não vira texto principal; linhas inválidas viram aviso; tipos desconhecidos somem', () => {
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'assistant',
          parent_tool_use_id: 'toolu_1',
          message: { content: [{ type: 'text', text: 'interno' }] }
        }),
        WT
      )
    ).toEqual([])
    expect(parseStreamLine('isto não é json', WT)).toEqual([
      { kind: 'info', text: 'isto não é json' }
    ])
    expect(parseStreamLine(JSON.stringify({ type: 'stream_event' }), WT)).toEqual([])
    expect(parseStreamLine('', WT)).toEqual([])
    expect(
      parseStreamLine(
        JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true }),
        WT
      )[0]
    ).toMatchObject({ kind: 'result', ok: false, costUsd: null })
  })
})

describe('política de permissões', () => {
  const ctx = { worktree: WT, allowRules: [] as { tool: string; pattern: string }[] }
  const bash = (command: string, allowRules = ctx.allowRules) =>
    evaluatePermission({ tool: 'Bash', input: { command } }, { ...ctx, allowRules })

  it('ler/editar dentro do worktree: permitido; fora: bloqueado', () => {
    expect(
      evaluatePermission({ tool: 'Edit', input: { file_path: `${WT}/src/a.ts` } }, ctx).decision
    ).toBe('allow')
    expect(
      evaluatePermission({ tool: 'Write', input: { file_path: 'docs/x.md' } }, ctx).decision
    ).toBe('allow')
    expect(
      evaluatePermission({ tool: 'Edit', input: { file_path: '/home/u/projeto/src/a.ts' } }, ctx)
    ).toEqual({
      decision: 'deny',
      reason: POLICY_MESSAGES.outside
    })
    expect(
      evaluatePermission({ tool: 'Read', input: { file_path: `${WT}/../ORK-8/x` } }, ctx).decision
    ).toBe('deny')
    expect(
      evaluatePermission({ tool: 'Read', input: { file_path: '/etc/passwd' } }, ctx).decision
    ).toBe('deny')
    expect(isInside(`${WT}-outro/x`, WT)).toBe(false)
  })

  it('git push bloqueado em todas as formas, mesmo aprovado "sempre"', () => {
    for (const cmd of [
      'git push',
      'git push origin ORK-7/x',
      'git -C . push',
      'git -c push.default=current push',
      'npm test && git push',
      'echo ok; GIT_SSH_COMMAND=x git push -f',
      'env FOO=1 git push',
      '/usr/bin/git push',
      'echo $(git push)'
    ]) {
      expect(bash(cmd, [{ tool: 'Bash', pattern: 'git' }])).toEqual({
        decision: 'deny',
        reason: POLICY_MESSAGES.push
      })
    }
    expect(bash('gh pr create --fill')).toEqual({ decision: 'deny', reason: POLICY_MESSAGES.gh })
    expect(bash('gh api repos/x/y')).toMatchObject({ decision: 'deny' })
    // "push" como texto não é push.
    expect(bash('git log --grep push').decision).toBe('ask')
    expect(bash('git status').decision).toBe('ask')
  })

  it('comandos que saem do worktree são bloqueados', () => {
    expect(bash('cat ~/.ssh/id_rsa').decision).toBe('deny')
    expect(bash('rm -rf /home/u/projeto').decision).toBe('deny')
    expect(bash('cd ../../ && ls').decision).toBe('deny')
    expect(bash('npm test > /dev/null').decision).toBe('ask')
    expect(bash(`ls ${WT}/src`).decision).toBe('ask')
  })

  it('shell pede aprovação com sugestão; "sempre neste projeto" vale por prefixo e por trecho', () => {
    expect(bash('npm test -- --watch=false')).toEqual({ decision: 'ask', suggestion: 'npm test' })
    expect(suggestPattern('pnpm -s lint')).toBe('pnpm lint')
    const rules = [{ tool: 'Bash', pattern: 'npm test' }]
    expect(bash('npm test -- --run', rules).decision).toBe('allow')
    expect(bash('npm test && rm -rf build', rules).decision).toBe('ask')
    expect(bash('npm testing', rules).decision).toBe('ask')
    expect(shellSegments('a && b || c; d | e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('pergunta do Claude, ferramentas inofensivas e desconhecidas', () => {
    expect(evaluatePermission({ tool: 'AskUserQuestion', input: {} }, ctx)).toEqual({
      decision: 'question'
    })
    expect(evaluatePermission({ tool: 'TodoWrite', input: {} }, ctx).decision).toBe('allow')
    expect(
      evaluatePermission({ tool: 'WebFetch', input: { url: 'https://x' } }, ctx).decision
    ).toBe('ask')
    expect(evaluatePermission({ tool: 'mcp__x__y', input: {} }, ctx).decision).toBe('ask')
  })
})

describe('redação de segredos e ambiente', () => {
  it('tokens conhecidos e atribuições sensíveis', () => {
    const text =
      'token ntn_abcdefghijklmnopqrstuvwx e ghp_abcdefghijklmnopqrstuvwxyz e sk-ant-api03-abcdefghijklmnop\nDATABASE_PASSWORD="p@ss" API_KEY=xyz'
    const out = redactSecrets(text)
    expect(out).not.toMatch(/ntn_abc|ghp_abc|sk-ant-api03|p@ss|xyz/)
    expect(out).toContain('DATABASE_PASSWORD=[omitido]')
  })
  it('arquivos .env e ambiente do processo', () => {
    expect(isEnvFile('/x/.env')).toBe(true)
    expect(isEnvFile('apps/web/.env.local')).toBe(true)
    expect(isEnvFile('src/env.ts')).toBe(false)
    expect(
      sanitizeEnv({
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'k',
        CLAUDE_CODE_OAUTH_TOKEN: 't',
        ELECTRON_RUN_AS_NODE: '1',
        HOME: '/h'
      })
    ).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})

describe('briefing', () => {
  const blocks = [
    { type: 'heading_2', heading_2: { rich_text: rt('Objetivo') } },
    {
      type: 'paragraph',
      paragraph: {
        rich_text: [
          ...rt('Listar '),
          ...rt('tarefas', { bold: true }),
          ...rt(' do ', {}, null),
          ...rt('Notion', {}, 'https://notion.so')
        ]
      }
    },
    {
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: rt('item A') },
      children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('sub') } }]
    },
    { type: 'numbered_list_item', numbered_list_item: { rich_text: rt('um') } },
    { type: 'numbered_list_item', numbered_list_item: { rich_text: rt('dois') } },
    { type: 'to_do', to_do: { rich_text: rt('feito'), checked: true } },
    { type: 'code', code: { rich_text: rt('npm test'), language: 'bash' } },
    { type: 'heading_2', heading_2: { rich_text: rt('Critérios de aceite') } },
    { type: 'to_do', to_do: { rich_text: rt('lista aparece'), checked: false } },
    { type: 'heading_2', heading_2: { rich_text: rt('Notas') } },
    { type: 'callout', callout: { rich_text: rt('cuidado'), icon: { emoji: '⚠️' } } },
    {
      type: 'table',
      table: {},
      children: [
        { type: 'table_row', table_row: { cells: [rt('a'), rt('b')] } },
        { type: 'table_row', table_row: { cells: [rt('1'), rt('2|3')] } }
      ]
    },
    { type: 'image', image: { external: { url: 'https://img/x.png' }, caption: rt('tela') } },
    { type: 'ai_block', ai_block: {} },
    { type: 'breadcrumb', breadcrumb: {} }
  ]

  it('blocos → markdown, com aviso para tipos não suportados', () => {
    const { markdown, unsupported } = blocksToMarkdown(blocks)
    expect(markdown).toContain('## Objetivo')
    expect(markdown).toContain('Listar **tarefas** do [Notion](https://notion.so)')
    expect(markdown).toContain('- item A\n  - sub')
    expect(markdown).toContain('1. um')
    expect(markdown).toContain('2. dois')
    expect(markdown).toContain('- [x] feito')
    expect(markdown).toContain('```bash\nnpm test\n```')
    expect(markdown).toContain('> ⚠️ cuidado')
    expect(markdown).toContain('| a | b |\n| --- | --- |\n| 1 | 2\\|3 |')
    expect(markdown).toContain('[imagem: tela](https://img/x.png)')
    expect(markdown).toContain('Bloco do Notion não convertido (ai_block)')
    expect(unsupported).toEqual(['ai_block', 'breadcrumb'])
  })

  it('briefing com propriedades, contexto, PR, critérios e avisos', () => {
    const { markdown, unsupported } = blocksToMarkdown(blocks)
    expect(extractAcceptanceCriteria(markdown)).toBe('- [ ] lista aparece')
    const briefing = buildBriefing({
      displayId: 'ORK-7',
      title: 'Listar tarefas',
      url: 'https://www.notion.so/ORK-7',
      properties: [
        { name: 'Status', value: 'Em andamento' },
        { name: 'Prioridade', value: '' }
      ],
      pageMarkdown: markdown,
      unsupported,
      project: { name: 'orkio', repo: 'acme/orkio', branch: 'ORK-7/listar-tarefas', worktree: WT },
      pr: { number: 12, state: 'aberta', url: 'https://github.com/acme/orkio/pull/12' }
    })
    expect(briefing.startsWith('# ORK-7 — Listar tarefas')).toBe(true)
    expect(briefing).toContain('- **Status:** Em andamento')
    expect(briefing).not.toContain('Prioridade')
    expect(briefing).toContain(
      'Branch de trabalho: ORK-7/listar-tarefas (worktree isolado). Não faça push nem abra PR: o Orkio faz isso pelo botão “Abrir PR” (ou pelo passo de entrega do fluxo). Se o usuário pedir, diga isso a ele.'
    )
    expect(briefing).toContain('PR: #12 (aberta)')
    expect(briefing).toContain('## Critérios de aceite\n\n- [ ] lista aparece')
    expect(briefing).toContain('2 bloco(s) do Notion não foram convertidos (ai_block, breadcrumb)')
  })

  it('página vazia', () => {
    const b = buildBriefing({
      displayId: 'ORK-1',
      title: 'x',
      url: null,
      properties: [],
      pageMarkdown: '',
      unsupported: [],
      project: { name: 'p', repo: null, branch: 'ORK-1/x', worktree: WT },
      pr: null
    })
    expect(b).toContain('_A página da tarefa está vazia._')
    expect(b).toContain('PR: ainda não existe')
  })

  it('hook do projeto vira só uma linha no log (sem a saída)', () => {
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'system',
          subtype: 'hook_response',
          hook_event_name: 'PostToolUse',
          stdout: 'SEGREDO=abc'
        }),
        '/wt'
      )
    ).toEqual([{ kind: 'info', text: 'Hook do projeto rodou: PostToolUse' }])
  })
})

describe('POLICY_MESSAGES: o caminho para publicar', () => {
  it('push e gh dizem para usar “Abrir PR” e mantêm o começo reconhecido', () => {
    expect(POLICY_MESSAGES.push).toMatch(
      /^Bloqueado pelo Orkio: git push só é permitido em um passo/
    )
    expect(POLICY_MESSAGES.gh).toMatch(/^Bloqueado pelo Orkio: comandos do GitHub CLI que publicam/)
    for (const m of [POLICY_MESSAGES.push, POLICY_MESSAGES.gh])
      expect(m).toContain('Para publicar, use “Abrir PR” na aba PR & CI da tarefa.')
  })
})
