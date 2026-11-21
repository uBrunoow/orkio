/**
 * Leitura do diff unificado do git (`git diff --no-color`), puro, tolerante: texto cortado no meio
 * (limite do main) ou linhas estranhas nunca lançam erro; o que não se entende vira contexto.
 */

export type DiffLineKind = 'add' | 'del' | 'context'

export interface DiffLine {
  kind: DiffLineKind
  /** Número na versão antiga (`null` em linha adicionada). */
  oldNo: number | null
  /** Número na versão nova (`null` em linha removida). */
  newNo: number | null
  text: string
}

export interface DiffHunk {
  /** "@@ -1,3 +1,4 @@ função" */
  header: string
  lines: DiffLine[]
}

export type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'renamed'

export interface DiffFile {
  path: string
  /** Caminho antigo quando o arquivo foi renomeado. */
  oldPath: string | null
  status: DiffFileStatus
  binary: boolean
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

/** Nomes com caracteres especiais vêm entre aspas, com escapes; mostramos a forma simples. */
function unquote(path: string): string {
  const t = path.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return t
}

function stripPrefix(path: string): string {
  const p = unquote(path)
  return /^[ab]\//.test(p) ? p.slice(2) : p
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  const rows = text.split('\n')
  // O \n final do texto deixa uma linha vazia que não é contexto.
  if (rows[rows.length - 1] === '') rows.pop()

  for (const raw of rows) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (.+) (.+)$/.exec(line)
      const header = m ? stripPrefix(m[2] ?? '') : '?'
      file = {
        path: header,
        oldPath: null,
        status: 'modified',
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: []
      }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue

    if (!hunk) {
      // Cabeçalho do arquivo (antes do primeiro @@).
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) {
        file.oldPath = unquote(line.slice('rename from '.length))
        file.status = 'renamed'
      } else if (line.startsWith('rename to ')) {
        file.path = unquote(line.slice('rename to '.length))
      } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        file.binary = true
      } else if (line.startsWith('--- ')) {
        const p = line.slice(4)
        if (p === '/dev/null') file.status = 'added'
      } else if (line.startsWith('+++ ')) {
        const p = line.slice(4)
        if (p === '/dev/null') file.status = 'deleted'
        else file.path = stripPrefix(p)
      }
    }

    const h = HUNK.exec(line)
    if (h) {
      oldNo = Number(h[1])
      newNo = Number(h[2])
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldNo: null, newNo, text: line.slice(1) })
      newNo += 1
      file.additions += 1
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldNo, newNo: null, text: line.slice(1) })
      oldNo += 1
      file.deletions += 1
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file": informação sobre a linha anterior, sem linha própria.
    } else if (line.startsWith(' ') || line === '') {
      // Uma linha vazia no meio de um hunk é contexto vazio (algumas ferramentas tiram o espaço).
      hunk.lines.push({ kind: 'context', oldNo, newNo, text: line.slice(1) })
      oldNo += 1
      newNo += 1
    }
  }

  return files
}

export interface DiffTotals {
  files: number
  additions: number
  deletions: number
}

export function diffTotals(files: readonly DiffFile[]): DiffTotals {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0)
  }
}

/** Linhas de um arquivo (soma dos hunks): decide o que abre sozinho e o que recolhe. */
export function diffLineCount(file: DiffFile): number {
  return file.hunks.reduce((n, h) => n + h.lines.length, 0)
}
