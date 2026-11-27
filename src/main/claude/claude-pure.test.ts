import { describe, expect, it } from 'vitest'
import { blocksToMarkdown, buildBriefing, extractAcceptanceCriteria } from '../../shared/briefing'
import {
  POLICY_MESSAGES,
  evaluatePermission,
  isInside,
  shellSegments,
  suggestPattern
} from './policy'
import { decidePermission, isGitRead } from './policy'
import { isEnvFile, redactSecrets, sanitizeEnv } from '../platform/redact'
import { parseStreamLine, toolImages } from './stream'

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
  it('janela conhecida (aprendida do CLI) vence o chute pelo nome; uso acima de 200 mil = 1 milhão', () => {
    expect(parseStreamLine(line({}), WT, undefined, 'claude-opus-5-5', 1_000_000)[0]).toEqual({
      kind: 'usage',
      inputTokens: 82_000,
      contextWindow: 1_000_000
    })
    const big = line({
      message: {
        content: [{ type: 'text', text: 'oi' }],
        usage: { input_tokens: 2, cache_read_input_tokens: 215_000 }
      }
    })
    expect(parseStreamLine(big, WT, undefined, 'claude-opus-5-5')[0]).toMatchObject({
      contextWindow: 1_000_000
    })
  })
  it('resultado traz a janela real do modelo (modelUsage.contextWindow)', () => {
    const result = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'feito',
      modelUsage: { 'claude-opus-5-5': { contextWindow: 1_000_000 } }
    })
    expect(parseStreamLine(result, WT, undefined, 'claude-opus-5-5')[0]).toMatchObject({
      kind: 'result',
      contextWindow: 1_000_000
    })
  })
  it('texto da conversa principal leva o id da mensagem (Ramificar daqui); id estranho não', () => {
    const text = (over: Record<string, unknown>) =>
      parseStreamLine(line(over), WT).find((e) => e.kind === 'text')
    expect(text({ uuid: '0f8c2a3e-1b2c-4d5e-8f90-123456789abc' })).toEqual({
      kind: 'text',
      text: 'oi',
      uuid: '0f8c2a3e-1b2c-4d5e-8f90-123456789abc'
    })
    expect(text({ uuid: '--fork-session' })).toEqual({ kind: 'text', text: 'oi' })
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
    ).toEqual([
      { kind: 'tool', id: 'r1', tool: 'Read', summary: 'a.ts', file: 'a.ts', parent: 't1' }
    ])
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

describe('política: heredoc', () => {
  const ctx = { worktree: WT, allowRules: [] as { tool: string; pattern: string }[] }
  const bash = (command: string): string =>
    evaluatePermission({ tool: 'Bash', input: { command } }, ctx).decision
  it('mensagem de commit em heredoc com /api/... não é caminho fora do worktree', () => {
    const msg = 'feat: x\n\n- T4: campos em /api/home/kpis/\n- T5: /api/tv/b2b/'
    expect(bash(`cd ${WT}; git commit -q -F - <<'EOF'\n${msg}\nEOF`)).toBe('ask')
    expect(bash(`cat <<EOF > notas.md\nveja /etc/hosts\nEOF`)).toBe('ask')
  })
  it('heredoc executado por um shell continua conferido; caminho fora na linha do comando também', () => {
    expect(bash(`bash <<'EOF'\ncat /etc/passwd\nEOF`)).toBe('deny')
    expect(bash(`git commit -F /tmp/msg <<'EOF'\nx\nEOF`)).toBe('deny')
    expect(bash(`cat <<EOF > /etc/x\nx\nEOF`)).toBe('deny')
    // Depois do fim do heredoc, a próxima linha é comando de novo.
    expect(bash(`git commit -F - <<'EOF'\nx\nEOF\ncat /etc/passwd`)).toBe('deny')
  })
})

describe('política: só leitura e contexto pedido pela política', () => {
  const rules = [{ tool: 'Bash', pattern: 'npm test' }]
  it('bug: só leitura — regra "sempre" não libera, ler a PR pergunta, editar é bloqueado', () => {
    const repo = {
      owner: 'acme',
      repo: 'app',
      remote: 'origin',
      branch: 'feat/x',
      defaultBranch: 'main',
      displayId: 'ORK-7'
    }
    const ro = { worktree: WT, allowRules: rules, repo, readOnly: true }
    const rw = { ...ro, readOnly: false }
    const bash = (command: string, c: typeof ro) =>
      evaluatePermission({ tool: 'Bash', input: { command } }, c).decision
    expect(bash('npm test', rw)).toBe('allow')
    expect(bash('npm test', ro)).toBe('ask')
    expect(bash('gh pr view 1', rw)).toBe('allow')
    expect(bash('gh pr view 1', ro)).toBe('ask')
    expect(bash('git push', ro)).toBe('deny')
    expect(
      evaluatePermission({ tool: 'Edit', input: { file_path: `${WT}/a.ts` } }, ro)
    ).toMatchObject({ decision: 'deny', code: 'read_only' })
    expect(
      evaluatePermission({ tool: 'Read', input: { file_path: `${WT}/a.ts` } }, ro).decision
    ).toBe('allow')
  })

  it('Fase 3: só leitura — ler o git na pasta passa sem perguntar; o resto continua perguntando', () => {
    const ro = { worktree: WT, allowRules: rules, readOnly: true }
    const bash = (command: string) =>
      evaluatePermission({ tool: 'Bash', input: { command } }, ro).decision
    expect(bash('git diff origin/main...HEAD')).toBe('allow')
    expect(bash('git --no-pager log --oneline -5')).toBe('allow')
    expect(bash('git show HEAD~1 && git status')).toBe('allow')
    // Opções que gravam ou rodam programa, opção global, subcomando que escreve, redireção.
    expect(bash('git diff --output=x.patch')).toBe('ask')
    expect(bash('git diff --ext-diff')).toBe('ask')
    expect(bash('git -c core.pager=sh diff')).toBe('ask')
    expect(bash('git -C /tmp log')).not.toBe('allow')
    expect(bash('git checkout -b x')).toBe('ask')
    expect(bash('git diff > patch.txt')).toBe('ask')
    expect(bash('git diff $(rm -rf .)')).not.toBe('allow')
    expect(bash('git push')).toBe('deny')
    // Fora do só leitura, nada muda (pergunta, como antes).
    expect(
      evaluatePermission(
        { tool: 'Bash', input: { command: 'git diff' } },
        { ...ro, readOnly: false }
      ).decision
    ).toBe('ask')
    expect(isGitRead({ name: 'git', args: ['diff', '--stat'] })).toBe(true)
    expect(isGitRead({ name: 'git', args: ['grep', '-O', 'x'] })).toBe(false)
  })

  it('Fase 3: a ferramenta "lembrar" do Orkio passa sem perguntar (só ela; outra MCP pergunta)', () => {
    const ro = { worktree: WT, allowRules: rules, readOnly: true }
    expect(
      evaluatePermission({ tool: 'mcp__orkio__lembrar', input: { texto: 'x' } }, ro).decision
    ).toBe('allow')
    expect(evaluatePermission({ tool: 'mcp__outro__lembrar', input: {} }, ro).decision).toBe('ask')
  })

  it('servidores da tarefa: servidor_* do Orkio passam sem perguntar; só leitura só status/log', () => {
    const full = { worktree: WT, allowRules: rules }
    const ro = { ...full, readOnly: true }
    for (const tool of ['subir', 'parar', 'status', 'log']) {
      expect(
        evaluatePermission({ tool: `mcp__orkio__servidor_${tool}`, input: {} }, full).decision
      ).toBe('allow')
    }
    expect(evaluatePermission({ tool: 'mcp__orkio__servidor_log', input: {} }, ro).decision).toBe(
      'allow'
    )
    expect(evaluatePermission({ tool: 'mcp__orkio__servidor_subir', input: {} }, ro).decision).toBe(
      'deny'
    )
    expect(evaluatePermission({ tool: 'mcp__orkio__servidor_rm', input: {} }, full).decision).toBe(
      'ask'
    )
    expect(
      evaluatePermission({ tool: 'mcp__outro__servidor_subir', input: {} }, full).decision
    ).toBe('ask')
  })

  it('Playwright no localhost dos servidores da tarefa passa sem perguntar; o resto pergunta', () => {
    const ctx = { worktree: WT, allowRules: rules, serverPorts: [4100, 4200] }
    const pw = (
      tool: string,
      input: Record<string, unknown> = {},
      c: Parameters<typeof evaluatePermission>[1] = ctx
    ): string => evaluatePermission({ tool: `mcp__playwright__browser_${tool}`, input }, c).decision
    expect(pw('navigate', { url: 'http://localhost:4100/login' })).toBe('allow')
    expect(pw('navigate', { url: 'http://127.0.0.1:4200' })).toBe('allow')
    expect(pw('navigate', { url: 'http://[::1]:4100/' })).toBe('allow')
    for (const tool of ['click', 'type', 'snapshot', 'take_screenshot', 'wait_for', 'press_key']) {
      expect(pw(tool, { element: 'Entrar', ref: 'e1' })).toBe('allow')
    }
    // Do plugin do seu Claude também.
    expect(
      evaluatePermission(
        { tool: 'mcp__plugin_playwright_playwright__browser_click', input: {} },
        ctx
      ).decision
    ).toBe('allow')
    // Outra porta, outro host, outro esquema ou ferramenta que roda código: pergunta.
    expect(pw('navigate', { url: 'http://localhost:5432' })).toBe('ask')
    expect(pw('navigate', { url: 'https://exemplo.com' })).toBe('ask')
    expect(pw('navigate', { url: 'http://localhost.evil.com:4100' })).toBe('ask')
    expect(pw('navigate', { url: 'file:///etc/passwd' })).toBe('ask')
    expect(pw('evaluate', { function: '() => 1' })).toBe('ask')
    expect(pw('run_code_unsafe', { code: 'x' })).toBe('ask')
    expect(pw('file_upload', { paths: ['/etc/passwd'] })).toBe('ask')
    expect(pw('tabs', { action: 'new', url: 'https://exemplo.com' })).toBe('ask')
    // Sem servidor rodando nesta tarefa, ou num passo só de leitura: pergunta como antes.
    expect(pw('click', {}, { ...ctx, serverPorts: [] })).toBe('ask')
    expect(pw('click', {}, { ...ctx, readOnly: true })).toBe('ask')
    // Outro MCP com o mesmo nome de ferramenta: pergunta.
    expect(evaluatePermission({ tool: 'mcp__outro__browser_click', input: {} }, ctx).decision).toBe(
      'ask'
    )
  })

  it('Fase 3: agente que pede antes de agir — editar pergunta (sem "sempre"), regra não libera', () => {
    const ask = { worktree: WT, allowRules: rules, askEdits: true }
    const edit = (file: string, c: { worktree: string; allowRules: typeof rules }) =>
      evaluatePermission({ tool: 'Edit', input: { file_path: file } }, c)
    expect(edit(`${WT}/a.ts`, ask)).toEqual({ decision: 'ask', suggestion: '' })
    expect(edit(`${WT}/a.ts`, { worktree: WT, allowRules: rules }).decision).toBe('allow')
    // Fora do worktree continua bloqueado (a autonomia só restringe).
    expect(edit('/etc/passwd', ask)).toMatchObject({ decision: 'deny', code: 'outside' })
    expect(
      evaluatePermission({ tool: 'Write', input: { file_path: `${WT}/b.ts` } }, ask).decision
    ).toBe('ask')
    expect(
      evaluatePermission({ tool: 'Read', input: { file_path: `${WT}/a.ts` } }, ask).decision
    ).toBe('allow')
    expect(evaluatePermission({ tool: 'Bash', input: { command: 'npm test' } }, ask).decision).toBe(
      'ask'
    )
    expect(evaluatePermission({ tool: 'Bash', input: { command: 'git push' } }, ask).decision).toBe(
      'deny'
    )
  })

  it('bug: push por alias no modo entrega — a política pede a branch atual (só quando precisa)', async () => {
    const target = {
      owner: 'acme',
      repo: 'app',
      remote: 'origin',
      branch: 'feat/ORK-7-x',
      defaultBranch: 'main',
      displayId: 'ORK-7'
    }
    const ctx = {
      worktree: WT,
      allowRules: [],
      aliases: { git: { p: 'push' } },
      delivery: {
        target,
        requirePushApproval: false,
        granted: new Set<'push'>(['push']),
        pushDefault: null
      }
    }
    let reads = 0
    const lazy = {
      currentBranch: async () => {
        reads++
        return 'feat/ORK-7-x'
      }
    }
    expect(
      await decidePermission({ tool: 'Bash', input: { command: 'git p' } }, ctx, lazy)
    ).toMatchObject({
      decision: 'allow'
    })
    expect(reads).toBe(1)
    // Push com a branch explícita, ou outro comando: nada a ler.
    await decidePermission(
      { tool: 'Bash', input: { command: 'git p origin feat/ORK-7-x' } },
      ctx,
      lazy
    )
    await decidePermission({ tool: 'Bash', input: { command: 'ls' } }, ctx, lazy)
    expect(reads).toBe(1)
    // Na branch errada, o motivo é a branch (não "não deu para saber a branch").
    const wrong = await decidePermission({ tool: 'Bash', input: { command: 'git p' } }, ctx, {
      currentBranch: async () => 'main'
    })
    expect(wrong).toMatchObject({
      decision: 'deny',
      code: 'delivery',
      reason: expect.stringMatching(/protegida|padrão/)
    })
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
      reason: POLICY_MESSAGES.outside,
      code: 'outside'
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
        reason: POLICY_MESSAGES.push,
        code: 'push'
      })
    }
    expect(bash('gh pr create --fill')).toEqual({
      decision: 'deny',
      reason: POLICY_MESSAGES.gh,
      code: 'gh'
    })
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

  it('atribuição de variável sozinha não vira a sugestão nem trava o "sempre"', () => {
    const cmd = `B=${WT}/backend; ls $B | grep -i req`
    expect(bash(cmd)).toEqual({ decision: 'ask', suggestion: 'ls' })
    const rules = [
      { tool: 'Bash', pattern: 'ls' },
      { tool: 'Bash', pattern: 'grep' }
    ]
    expect(bash(cmd, rules).decision).toBe('allow')
    expect(bash('B=/etc; ls $B', rules).decision).toBe('deny')
  })

  it('cd para uma pasta do worktree não vira a sugestão nem trava o "sempre"', () => {
    const cmd = `cd ${WT}/frontend && pnpm test -- --run`
    expect(bash(cmd)).toEqual({ decision: 'ask', suggestion: 'pnpm test' })
    const rules = [{ tool: 'Bash', pattern: 'pnpm test' }]
    expect(bash(cmd, rules).decision).toBe('allow')
    expect(bash('cd frontend; pnpm test', rules).decision).toBe('allow')
    // Só o cd não basta: o comando depois dele precisa da regra.
    expect(bash(`cd ${WT}/frontend && rm -rf build`, rules).decision).toBe('ask')
    // cd sozinho (HOME), cd -, variável e caminho de fora continuam fora da regra.
    expect(bash('cd && pnpm test', rules).decision).toBe('ask')
    expect(bash('cd - && pnpm test', rules).decision).toBe('ask')
    expect(bash('cd $D && pnpm test', rules).decision).toBe('ask')
    expect(bash('cd /tmp && pnpm test', rules).decision).toBe('deny')
    // Uma regra `cd` salva antes da correção não libera o resto.
    expect(bash(`cd ${WT} && rm -rf src`, [{ tool: 'Bash', pattern: 'cd' }]).decision).toBe('ask')
  })

  it('corpo do heredoc é entrada do programa: a regra vale pelo programa', () => {
    const cmd = `cd ${WT}/frontend; python3 - <<'EOF'\ndef sub(p, old, new): s=open(p).read(); assert old in s\nEOF`
    expect(bash(cmd)).toEqual({ decision: 'ask', suggestion: 'python3' })
    expect(bash(cmd, [{ tool: 'Bash', pattern: 'python3' }]).decision).toBe('allow')
    expect(bash(`${cmd}\nrm -rf x`, [{ tool: 'Bash', pattern: 'python3' }]).decision).toBe('ask')
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
    // A branch de trabalho e o caminho para publicar (o agente não faz push: é o “Abrir PR”).
    const branchLine = briefing.split('\n').find((l) => l.includes('ORK-7/listar-tarefas'))
    expect(branchLine).toMatch(/push/)
    expect(branchLine).toContain('“Abrir PR”')
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
  it('push e gh dizem para usar “Abrir PR” (a tela decide o botão pelo código)', () => {
    for (const m of [POLICY_MESSAGES.push, POLICY_MESSAGES.gh]) expect(m).toContain('“Abrir PR”')
  })
})

describe('stream-json → imagens das ferramentas', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const line = JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: [
            { type: 'text', text: 'print' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') }
            }
          ]
        }
      ]
    }
  })

  it('toolImages devolve os bytes e o id da ferramenta; o evento do log fica sem o base64', () => {
    const imgs = toolImages(line)
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.toolId).toBe('tu_1')
    expect(Buffer.compare(imgs[0]!.data, PNG)).toBe(0)
    expect(parseStreamLine(line, WT)).toEqual([{ kind: 'tool_result', id: 'tu_1', error: false }])
    expect(JSON.stringify(parseStreamLine(line, WT))).not.toContain(PNG.toString('base64'))
    expect(toolImages(JSON.stringify({ type: 'user', message: { content: [] } }))).toEqual([])
    expect(toolImages('não é json')).toEqual([])
  })
})

describe('ponte: ferramentas dos servidores', () => {
  it('codifica e lê a ação; ação desconhecida não vira pedido de permissão', async () => {
    const { decodeBridgeMessage, encodeBridgeServer, serverActionOfTool, parseServerReply } =
      await import('./bridge/protocol')
    expect(decodeBridgeMessage(encodeBridgeServer('tk', 'subir', { nome: 'web' }))).toEqual({
      token: 'tk',
      message: { kind: 'server', action: 'subir', input: { nome: 'web' } }
    })
    expect(
      decodeBridgeMessage(JSON.stringify({ token: 'tk', kind: 'server', action: 'rm', input: {} }))
    ).toBeNull()
    expect(serverActionOfTool('mcp__orkio__servidor_log')).toBe('log')
    expect(serverActionOfTool('mcp__orkio__servidor_x')).toBeNull()
    expect(parseServerReply({ ok: true, message: 'x'.repeat(20_000) }).message).toHaveLength(12_000)
  })
})
