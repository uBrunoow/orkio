/**
 * Memória por agente (Fase 3) no disco. O modelo (formato, orçamento, resumo) é de
 * `shared/agent-memory.ts`; aqui ficam as pastas, o histórico, o digest e a redação.
 *
 * Pasta de cada agente em `<userData>/agent-memory/`:
 * - `local/<id>/` e `builtin/<id>/`: o agente vale em todos os projetos, a memória também;
 * - `repo/<projectId>/<id>/`: o perfil é do repositório, a memória é por projeto.
 *
 * Dentro: `MEMORY.md` (as notas), `archive.md` (vencidas, que estouraram o orçamento ou que você
 * arquivou) e `history/<foto>.md` (o `MEMORY.md` antes de cada mudança, as 50 últimas). Pastas
 * 0700, arquivos 0600, escrita atômica; `archive.md` é gravado ANTES do `MEMORY.md` (uma queda no
 * meio pode repetir uma arquivada, nunca perder a nota). Toda escrita passa por `redactSecrets`.
 * Edições da tela mandam o digest lido: memória mudou no meio = `stale`. Uma escrita por agente
 * por vez (uma promise por pasta).
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MEMORY_LIMITS,
  MEMORY_MESSAGES,
  fitMemory,
  isMemorySnapshotId,
  localDate,
  memorySummary,
  memoryUsed,
  noteId,
  normalizeNoteText,
  parseMemory,
  parseRememberInput,
  serializeMemory,
  serializeNote,
  toNoteView,
  validateNoteInput,
  type AgentMemoryView,
  type MemoryHistoryEntry,
  type MemoryNote,
  type MemoryNoteInput
} from '../../shared/agent-memory'
import { parseAgentKey } from '../../shared/agent'
import { DomainError } from '../errors'
import { redactSecrets } from '../platform/redact'
import { atomicWriteFile } from '../storage/atomic-write'

const MEMORY_FILE = 'MEMORY.md'
const ARCHIVE_FILE = 'archive.md'
const HISTORY_DIR = 'history'
const PROJECT_ID = /^[A-Za-z0-9-]{1,100}$/
const WRITE = { mode: 0o600, fsync: true, dirMode: 0o700 } as const

export class AgentMemoryError extends DomainError {}

interface MemoryState {
  notes: MemoryNote[]
  archived: MemoryNote[]
}

/** Resposta da ferramenta `lembrar` (volta ao agente e, se anotou, vira linha do log). */
export type RememberResult =
  { ok: true; text: string; message: string } | { ok: false; message: string }

export interface AgentMemoryStoreDeps {
  /** `<userData>/agent-memory`. */
  root: string
  now?: () => Date
}

export class AgentMemoryStore {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: AgentMemoryStoreDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** Pasta do agente (chave e projeto validados: nada de caminho vindo de fora). */
  private dirFor(agentKey: string, projectId: string): string {
    const key = parseAgentKey(agentKey)
    if (!key) throw new AgentMemoryError('invalid', 'Agente inválido.')
    if (key.scope === 'repo') {
      if (!PROJECT_ID.test(projectId)) throw new AgentMemoryError('invalid', 'Projeto inválido.')
      return join(this.deps.root, 'repo', projectId, key.id)
    }
    return join(this.deps.root, key.scope, key.id)
  }

  /** Uma operação por pasta por vez (as outras esperam na fila). */
  private serialized<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(dir) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => undefined)
    this.locks.set(dir, tail)
    void tail.then(() => {
      if (this.locks.get(dir) === tail) this.locks.delete(dir)
    })
    return next
  }

  async read(agentKey: string, projectId: string): Promise<AgentMemoryView> {
    const dir = this.dirFor(agentKey, projectId)
    return this.serialized(dir, () => this.view(agentKey, dir))
  }

  /** Resumo para o início da conversa (notas válidas, gerais ou deste projeto). Vazio = nenhuma. */
  async summary(agentKey: string, projectId: string): Promise<string> {
    const dir = this.dirFor(agentKey, projectId)
    const raw = await readText(join(dir, MEMORY_FILE))
    return memorySummary(parseMemory(raw), { projectId, now: this.now() })
  }

  add(
    agentKey: string,
    projectId: string,
    input: MemoryNoteInput,
    digest: string | null
  ): Promise<AgentMemoryView> {
    const note = this.noteFrom(input, projectId, null)
    return this.mutate(agentKey, projectId, digest, (s) => ({
      ...s,
      notes: [...s.notes.filter((n) => serializeNote(n) !== serializeNote(note)), note]
    }))
  }

  edit(
    agentKey: string,
    projectId: string,
    digest: string,
    id: string,
    input: MemoryNoteInput
  ): Promise<AgentMemoryView> {
    return this.mutate(agentKey, projectId, digest, (s) => {
      const i = findNote(s.notes, id)
      const old = s.notes[i]!
      const next = this.noteFrom(input, projectId, old)
      const notes = [...s.notes]
      notes[i] = next
      return { ...s, notes }
    })
  }

  remove(
    agentKey: string,
    projectId: string,
    digest: string,
    id: string
  ): Promise<AgentMemoryView> {
    return this.mutate(agentKey, projectId, digest, (s) => {
      const i = findNote(s.notes, id)
      return { ...s, notes: s.notes.filter((_, j) => j !== i) }
    })
  }

  archive(
    agentKey: string,
    projectId: string,
    digest: string,
    id: string
  ): Promise<AgentMemoryView> {
    return this.mutate(agentKey, projectId, digest, (s) => {
      const i = findNote(s.notes, id)
      return { notes: s.notes.filter((_, j) => j !== i), archived: [...s.archived, s.notes[i]!] }
    })
  }

  /** Volta uma arquivada para a memória (validade vencida some, senão ela sairia de novo). */
  unarchive(
    agentKey: string,
    projectId: string,
    digest: string,
    id: string
  ): Promise<AgentMemoryView> {
    const today = localDate(this.now())
    return this.mutate(agentKey, projectId, digest, (s) => {
      const i = findNote(s.archived, id)
      const note = s.archived[i]!
      const restored = note.until !== null && note.until < today ? { ...note, until: null } : note
      return {
        notes: [...s.notes, restored],
        archived: s.archived.filter((_, j) => j !== i)
      }
    })
  }

  /** Volta para uma foto do histórico (passa pela redação e pelo orçamento como qualquer escrita). */
  rollback(
    agentKey: string,
    projectId: string,
    digest: string,
    snapshotId: string
  ): Promise<AgentMemoryView> {
    if (!isMemorySnapshotId(snapshotId)) {
      return Promise.reject(new AgentMemoryError('not_found', MEMORY_MESSAGES.snapshotMissing))
    }
    const dir = this.dirFor(agentKey, projectId)
    return this.mutate(agentKey, projectId, digest, async (s) => {
      const raw = await readText(join(dir, HISTORY_DIR, `${snapshotId}.md`), null)
      if (raw === null) throw new AgentMemoryError('not_found', MEMORY_MESSAGES.snapshotMissing)
      return { ...s, notes: parseMemory(raw) }
    })
  }

  /**
   * Ferramenta `lembrar` (o agente pediu, sem digest): valida a entrada (que veio do agente),
   * grava e diz o que aconteceu. Nunca lança.
   */
  async remember(
    agentKey: string,
    projectId: string,
    input: Record<string, unknown>
  ): Promise<RememberResult> {
    const parsed = parseRememberInput(input, localDate(this.now()))
    if (!parsed.ok) return { ok: false, message: `Não anotei: ${parsed.message}` }
    try {
      const view = await this.add(agentKey, projectId, parsed.value, null)
      const text = normalizeNoteText(redactSecrets(normalizeNoteText(parsed.value.text)))
      const kept = view.notes.some((n) => n.text === text)
      const where = parsed.value.scope === 'projeto' ? 'só neste projeto' : 'geral'
      return {
        ok: true,
        text,
        message: kept
          ? `Anotado na memória (${where}).`
          : `Anotado, mas a nota foi direto para as arquivadas (memória cheia ou já vencida).`
      }
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof DomainError
            ? `Não anotei: ${error.message}`
            : 'Não anotei: falha ao gravar a memória.'
      }
    }
  }

  // ── internos ──────────────────────────────────────────────────────────────────────────────

  private noteFrom(input: MemoryNoteInput, projectId: string, old: MemoryNote | null): MemoryNote {
    const today = localDate(this.now())
    const problem = validateNoteInput(input, today)
    if (problem) throw new AgentMemoryError('invalid', problem)
    if (!PROJECT_ID.test(projectId)) throw new AgentMemoryError('invalid', 'Projeto inválido.')
    return {
      text: normalizeNoteText(input.text),
      date: old ? old.date : today,
      // Editar uma nota de outro projeto mantém o projeto dela.
      projectId: input.scope === 'geral' ? null : (old?.projectId ?? projectId),
      until: input.until
    }
  }

  private mutate(
    agentKey: string,
    projectId: string,
    digest: string | null,
    change: (state: MemoryState) => MemoryState | Promise<MemoryState>
  ): Promise<AgentMemoryView> {
    const dir = this.dirFor(agentKey, projectId)
    return this.serialized(dir, async () => {
      const memoryPath = join(dir, MEMORY_FILE)
      const archivePath = join(dir, ARCHIVE_FILE)
      const raw = await readText(memoryPath)
      if (digest !== null && digest !== digestOf(raw)) {
        throw new AgentMemoryError('stale', MEMORY_MESSAGES.stale)
      }
      const archiveRaw = await readText(archivePath)
      const current: MemoryState = { notes: parseMemory(raw), archived: parseMemory(archiveRaw) }
      const changed = await change(current)
      const today = localDate(this.now())
      const fit = fitMemory(clean(changed.notes), today)
      if (fit.overflow) throw new AgentMemoryError('full', MEMORY_MESSAGES.full)
      const archived = dedupe(clean([...changed.archived, ...fit.archived])).slice(
        -MEMORY_LIMITS.archiveMax
      )
      const nextMemory = serializeMemory(fit.notes)
      const nextArchive = serializeMemory(archived, 'Memória arquivada')
      if (nextMemory !== raw || nextArchive !== archiveRaw) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        if (raw && nextMemory !== raw) await this.snapshot(dir, raw)
        if (nextArchive !== archiveRaw) await atomicWriteFile(archivePath, nextArchive, WRITE)
        if (nextMemory !== raw) await atomicWriteFile(memoryPath, nextMemory, WRITE)
      }
      return this.view(agentKey, dir)
    })
  }

  private async snapshot(dir: string, raw: string): Promise<void> {
    const historyDir = join(dir, HISTORY_DIR)
    const stamp = this.now().toISOString().replace(/[:.]/g, '-')
    // Mesmo milissegundo: a sequência (3 dígitos hex) mantém a ordem; o resto é aleatório.
    const before = await snapshotIds(historyDir)
    const seq = before.filter((b) => b.startsWith(stamp)).length
    const id = `${stamp}-${seq.toString(16).padStart(3, '0')}${randomBytes(2).toString('hex').slice(0, 3)}`
    await atomicWriteFile(join(historyDir, `${id}.md`), raw, WRITE)
    const all = await snapshotIds(historyDir)
    for (const old of all.slice(0, Math.max(0, all.length - MEMORY_LIMITS.historyKeep))) {
      await rm(join(historyDir, `${old}.md`), { force: true })
    }
  }

  private async view(agentKey: string, dir: string): Promise<AgentMemoryView> {
    const today = localDate(this.now())
    const raw = await readText(join(dir, MEMORY_FILE))
    const notes = parseMemory(raw)
    const archived = parseMemory(await readText(join(dir, ARCHIVE_FILE)))
    const history: MemoryHistoryEntry[] = []
    for (const id of (await snapshotIds(join(dir, HISTORY_DIR))).reverse()) {
      const text = await readText(join(dir, HISTORY_DIR, `${id}.md`))
      history.push({ id, at: snapshotTime(id), count: parseMemory(text).length })
    }
    return {
      agentKey,
      digest: digestOf(raw),
      notes: notes.map((n) => toNoteView(n, today)),
      // Arquivadas: as mais recentes primeiro.
      archived: archived.map((n) => toNoteView(n, today)).reverse(),
      history,
      used: memoryUsed(notes),
      budget: MEMORY_LIMITS.budget
    }
  }
}

export function digestOf(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

function findNote(notes: readonly MemoryNote[], id: string): number {
  const i = notes.findIndex((n) => noteId(n) === id)
  if (i < 0) throw new AgentMemoryError('not_found', MEMORY_MESSAGES.notFound)
  return i
}

/** Redação de segredos em cada texto (antes do disco); nota que ficou vazia some. */
function clean(notes: readonly MemoryNote[]): MemoryNote[] {
  return notes
    .map((n) => ({
      ...n,
      text: normalizeNoteText(redactSecrets(n.text)).slice(0, MEMORY_LIMITS.noteMax)
    }))
    .filter((n) => n.text.length > 0)
}

function dedupe(notes: readonly MemoryNote[]): MemoryNote[] {
  const seen = new Set<string>()
  return notes.filter((n) => {
    const line = serializeNote(n)
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
}

async function readText(path: string): Promise<string>
async function readText(path: string, missing: null): Promise<string | null>
async function readText(path: string, missing: string | null = ''): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return missing
  }
}

/** Fotos do histórico, da mais antiga para a mais nova (o nome começa pela hora). */
async function snapshotIds(historyDir: string): Promise<string[]> {
  const names = await readdir(historyDir).catch(() => [] as string[])
  return names
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.slice(0, -3))
    .filter(isMemorySnapshotId)
    .sort()
}

/** `2026-11-24T10-00-00-000Z-abc123` → ISO. */
function snapshotTime(id: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id)
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : ''
}
