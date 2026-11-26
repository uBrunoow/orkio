import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { slugify, taskBranchName } from '../../shared/slug'
import { TaskBranchesStore } from '../branches/task-branches.store'
import { openDatabase, type Db } from '../db/database'
import { createGit } from '../git/git'
import { isScratchPath } from '../../shared/orkio-scratch'
import { ensureScratch } from './scratch'
import { WorktreeService, type WorktreeProject } from './worktree.service'

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    .toString()
    .trim()
}

describe('slug', () => {
  it('título → slug curto, sem acento', () => {
    expect(slugify('Sincronizar tarefas do Notion!')).toBe('sincronizar-tarefas-do-notion')
    expect(slugify('Ação: corrigir “bug” — urgente')).toBe('acao-corrigir-bug-urgente')
    expect(slugify('???')).toBe('tarefa')
    expect(slugify('a'.repeat(80)).length).toBe(40)
    expect(taskBranchName('ORK-142', 'Sync Notion')).toBe('feat/ORK-142-sync-notion')
  })
})

describe('WorktreeService (git real)', () => {
  let tmp: string
  let main: string
  let db: Db
  let service: WorktreeService
  let project: WorktreeProject

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'orkio-wt-')))
    const bare = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
    const seed = join(tmp, 'seed')
    sh(tmp, 'clone', '-q', bare, seed)
    sh(seed, 'config', 'user.email', 't@t')
    sh(seed, 'config', 'user.name', 'T')
    writeFileSync(join(seed, 'README.md'), '# app\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-q', '-m', 'init')
    sh(seed, 'push', '-q', 'origin', 'main')
    // Branch remota de outra pessoa para ORK-9.
    sh(seed, 'checkout', '-q', '-b', 'ORK-9/remota')
    writeFileSync(join(seed, 'nove.txt'), '9\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-q', '-m', 'nove')
    sh(seed, 'push', '-q', 'origin', 'ORK-9/remota')

    // "Pasta principal" do usuário, com uma mudança não commitada que nunca pode ser tocada.
    main = join(tmp, 'meu-repo')
    sh(tmp, 'clone', '-q', bare, main)
    sh(main, 'config', 'user.email', 't@t')
    sh(main, 'config', 'user.name', 'T')
    writeFileSync(join(main, 'README.md'), '# app\nmudança local do usuário\n')
    sh(main, 'branch', 'feat/ORK-8-local')

    db = openDatabase(':memory:')
    service = new WorktreeService({ git: createGit(), db, root: join(tmp, 'worktrees') })
    project = { id: 'p1', localPath: main, remoteName: 'origin', defaultBranch: 'main' }
  })

  afterEach(() => {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  })

  const mainUntouched = () => {
    expect(sh(main, 'branch', '--show-current')).toBe('main')
    expect(readFileSync(join(main, 'README.md'), 'utf8')).toBe('# app\nmudança local do usuário\n')
    expect(sh(main, 'status', '--porcelain')).toBe('M README.md')
  }

  it('cria feat/<ID>-<slug> a partir de origin/main, fora da pasta principal', async () => {
    const wt = await service.ensure(project, {
      id: 't7',
      displayId: 'ORK-7',
      title: 'Listar tarefas'
    })
    expect(wt).toMatchObject({
      reused: 'new',
      branch: 'feat/ORK-7-listar-tarefas',
      baseRef: 'origin/main',
      path: join(tmp, 'worktrees', 'p1', 'ORK-7')
    })
    expect(sh(wt.path, 'branch', '--show-current')).toBe('feat/ORK-7-listar-tarefas')
    expect(readFileSync(join(wt.path, 'README.md'), 'utf8')).toBe('# app\n')
    mainUntouched()
    // De novo: reaproveita o mesmo worktree.
    expect(
      (await service.ensure(project, { id: 't7', displayId: 'ORK-7', title: 'x' })).reused
    ).toBe('worktree')
  })

  it('bug: o git falhar ao listar os worktrees nunca vira "remova a pasta"; tenta de novo', async () => {
    const task = { id: 't7', displayId: 'ORK-7', title: 'Listar tarefas' }
    const first = await service.ensure(project, task)
    const real = createGit()
    let fails = 1
    const flaky = new WorktreeService({
      git: {
        ...real,
        worktreeList: async (root: string) => {
          if (fails-- > 0) throw new Error('timeout')
          return real.worktreeList(root)
        }
      },
      db,
      root: join(tmp, 'worktrees')
    })
    // Uma falha só: a segunda tentativa acha o worktree.
    expect(await flaky.ensure(project, task)).toMatchObject({
      reused: 'worktree',
      path: first.path
    })
    // Falha sempre: erro do git, pasta intacta.
    fails = 99
    await expect(flaky.ensure(project, task)).rejects.toMatchObject({ code: 'git' })
    expect(existsSync(first.path)).toBe(true)
  })

  it('PR da branch já mergeada: abre worktree novo numa branch nova a partir da base', async () => {
    const task = { id: 't7', displayId: 'ORK-7', title: 'Listar tarefas' }
    const first = await service.ensure(project, task)
    const merged = (branch: string): number | null => (branch === first.branch ? 477 : null)
    // Mudança sem commit no worktree antigo: não apaga nada, explica.
    writeFileSync(join(first.path, 'README.md'), 'pendente\n')
    await expect(service.ensure(project, task, { merged })).rejects.toMatchObject({
      code: 'merged_dirty'
    })
    expect(readFileSync(join(first.path, 'README.md'), 'utf8')).toBe('pendente\n')
    sh(first.path, 'checkout', '--', 'README.md')
    // Limpo: o antigo sai (a branch fica) e o novo começa da base.
    const next = await service.ensure(project, task, { merged })
    expect(next).toMatchObject({
      reused: 'new',
      branch: 'feat/ORK-7-listar-tarefas-2',
      path: first.path
    })
    expect(sh(main, 'branch', '--list', first.branch)).toContain(first.branch)
    expect(sh(next.path, 'branch', '--show-current')).toBe('feat/ORK-7-listar-tarefas-2')
    // Sem worktree registrado, a branch mergeada também não é reaproveitada.
    await service.remove(project, 't7', false)
    const again = await service.ensure(project, task, {
      merged: (b) => (b === first.branch || b === next.branch ? 1 : null)
    })
    expect(again.branch).toBe('feat/ORK-7-listar-tarefas-3')
    mainUntouched()
  })

  it('bug: sem ID, páginas do Notion com o mesmo começo de id não dividem a pasta', async () => {
    const a = await service.ensure(project, {
      id: '423a411e-ce3b-8190-a89f-ca1d8ce5e05f',
      displayId: null,
      title: 'Somar os pedidos'
    })
    const b = await service.ensure(project, {
      id: '423a411e-ce3b-8167-bf2c-f391c19a94a3',
      displayId: null,
      title: 'Outra tarefa'
    })
    expect(a.path).not.toBe(b.path)
    expect(b).toMatchObject({ reused: 'new', branch: 'feat/outra-tarefa' })
  })

  it('branch nova sai da base de entrega do projeto (ex.: dev), não da padrão', async () => {
    const seed = join(tmp, 'seed')
    sh(seed, 'checkout', '-q', 'main')
    sh(seed, 'checkout', '-q', '-b', 'dev')
    writeFileSync(join(seed, 'dev.txt'), 'dev\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-q', '-m', 'dev')
    sh(seed, 'push', '-q', 'origin', 'dev')
    const wt = await service.ensure(
      { ...project, baseBranch: 'dev' },
      { id: 't7', displayId: 'ORK-7', title: 'Listar' }
    )
    expect(wt).toMatchObject({ reused: 'new', baseRef: 'origin/dev' })
    expect(existsSync(join(wt.path, 'dev.txt'))).toBe(true)
    // Base que não existe no remoto: erro claro com o nome dela (nunca cai na main).
    await expect(
      service.ensure(
        { ...project, baseBranch: 'homolog' },
        { id: 't6', displayId: 'ORK-6', title: 'x' }
      )
    ).rejects.toMatchObject({ code: 'no_base', message: expect.stringContaining('origin/homolog') })
    mainUntouched()
  })

  it('reutiliza branch local e branch remota da tarefa (sem criar outra)', async () => {
    const local = await service.ensure(project, { id: 't8', displayId: 'ORK-8', title: 'Outro' })
    expect(local).toMatchObject({ reused: 'local_branch', branch: 'feat/ORK-8-local' })
    const remote = await service.ensure(project, { id: 't9', displayId: 'ORK-9', title: 'Nove' })
    expect(remote).toMatchObject({ reused: 'remote_branch', branch: 'ORK-9/remota' })
    expect(existsSync(join(remote.path, 'nove.txt'))).toBe(true)
    expect(sh(remote.path, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/ORK-9/remota')
    // ORK-90 não casa com ORK-9.
    const ninety = await service.ensure(project, {
      id: 't90',
      displayId: 'ORK-90',
      title: 'Noventa'
    })
    expect(ninety).toMatchObject({ reused: 'new', branch: 'feat/ORK-90-noventa' })
    mainUntouched()
  })

  it('remover recusa com mudanças não commitadas; com confirmação remove (a branch fica)', async () => {
    const wt = await service.ensure(project, { id: 't7', displayId: 'ORK-7', title: 'Listar' })
    writeFileSync(join(wt.path, 'novo.txt'), 'x')
    await expect(service.remove(project, 't7', false)).rejects.toMatchObject({
      code: 'dirty',
      files: ['novo.txt']
    })
    expect(existsSync(wt.path)).toBe(true)
    await service.remove(project, 't7', true)
    expect(existsSync(wt.path)).toBe(false)
    expect(service.get('t7')).toBeNull()
    expect(sh(main, 'branch', '--list', 'feat/ORK-7-listar')).toContain('feat/ORK-7-listar')
    mainUntouched()
  })

  it('branch da tarefa aberta na pasta principal → mensagem clara', async () => {
    sh(main, 'stash', '-q')
    sh(main, 'checkout', '-q', 'feat/ORK-8-local')
    await expect(
      service.ensure(project, { id: 't8', displayId: 'ORK-8', title: 'x' })
    ).rejects.toMatchObject({
      code: 'branch_checked_out'
    })
  })

  it('sem ID do Notion: cria <tipo>/<slug>, registra a branch e reaproveita depois', async () => {
    const page = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9'
    const wt = await service.ensure(
      project,
      { id: page, displayId: null, title: 'Corrigir login' },
      { kind: 'fix' }
    )
    expect(wt).toMatchObject({
      reused: 'new',
      branch: 'fix/corrigir-login',
      path: join(tmp, 'worktrees', 'p1', '1a2b3c4d5e6f40718293a4b5c6d7e8f9')
    })
    expect(new TaskBranchesStore(db).forTask('p1', page).map((l) => l.branch)).toEqual([
      'fix/corrigir-login'
    ])
    // Limpou a pasta de trabalho: a branch registrada volta a ser usada (não cria outra).
    await service.remove(project, page, true)
    const again = await service.ensure(project, {
      id: page,
      displayId: null,
      title: 'Corrigir login'
    })
    expect(again).toMatchObject({ reused: 'local_branch', branch: 'fix/corrigir-login' })
    // Outra tarefa com o mesmo título: nome com sufixo, sem tomar a branch da primeira.
    const other = await service.ensure(
      project,
      { id: 'p2', displayId: '42', title: 'Corrigir login' },
      { kind: 'fix' }
    )
    expect(other.branch).toBe('fix/corrigir-login-2')
    mainUntouched()
  })

  it('findTaskBranch: registrada antes do ID no nome, local antes de remota (a mesma do ensure)', async () => {
    expect(
      await service.findTaskBranch(project, { id: 't8', displayId: 'ORK-8', title: 'x' })
    ).toEqual({ branch: 'feat/ORK-8-local', where: 'local' })
    expect(
      await service.findTaskBranch(project, { id: 't9', displayId: 'ORK-9', title: 'x' })
    ).toEqual({ branch: 'ORK-9/remota', where: 'remote' })
    // Registrada para a tarefa vence o casamento pelo ID.
    sh(main, 'branch', 'outra-coisa')
    new TaskBranchesStore(db).link('p1', 't8', 'outra-coisa', 'manual')
    expect(
      await service.findTaskBranch(project, { id: 't8', displayId: 'ORK-8', title: 'x' })
    ).toEqual({ branch: 'outra-coisa', where: 'local' })
    const wt = await service.ensure(project, { id: 't8', displayId: 'ORK-8', title: 'x' })
    expect(wt).toMatchObject({ reused: 'local_branch', branch: 'outra-coisa' })
    // Sem ID e sem registro: nenhuma (sem nem listar as branches).
    expect(
      await service.findTaskBranch(project, { id: 'tx', displayId: null, title: 'x' })
    ).toBeNull()
  })

  it('bug: .orkio/ ignora só o rascunho; perfis em .orkio/agents/ continuam no git', async () => {
    // Perfil versionado no repositório.
    const seed = join(tmp, 'seed')
    sh(seed, 'checkout', '-q', 'main')
    execFileSync('mkdir', ['-p', join(seed, '.orkio', 'agents')])
    writeFileSync(join(seed, '.orkio', 'agents', 'ana.md'), 'v1\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-q', '-m', 'agente')
    sh(seed, 'push', '-q', 'origin', 'main')
    const wt = await service.ensure(project, { id: 't7', displayId: 'ORK-7', title: 'Listar' })
    await ensureScratch(wt.path)
    writeFileSync(join(wt.path, '.orkio', 'briefing.md'), '# briefing')
    execFileSync('mkdir', ['-p', join(wt.path, '.orkio', 'attachments')])
    writeFileSync(join(wt.path, '.orkio', 'attachments', 'a.png'), 'x')
    writeFileSync(join(wt.path, '.orkio', 'revisao.md'), 'r')
    writeFileSync(join(wt.path, '.orkio', 'agents', 'ana.md'), 'v2\n')
    writeFileSync(join(wt.path, '.orkio', 'agents', 'novo.md'), 'n\n')
    // Antes o `.gitignore` era `*`: um perfil novo nem aparecia no git.
    const status = sh(wt.path, 'status', '--porcelain', '-uall')
      .split('\n')
      .map((l) => l.trim())
      .sort()
    expect(status).toEqual(['?? .orkio/agents/novo.md', 'M .orkio/agents/ana.md'])
    // E o rascunho sai do resumo/diff/artefatos; os perfis não.
    expect(isScratchPath('.orkio/briefing.md')).toBe(true)
    expect(isScratchPath('.orkio/attachments/a.png')).toBe(true)
    expect(isScratchPath('.orkio/')).toBe(true)
    expect(isScratchPath('.orkio/agents/ana.md')).toBe(false)
    expect(isScratchPath('.orkio/agents')).toBe(false)
    expect(isScratchPath('src/.orkio/x')).toBe(false)
    expect(isScratchPath('docs/x.md')).toBe(false)
    mainUntouched()
  })
})
