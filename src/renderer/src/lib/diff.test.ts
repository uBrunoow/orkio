import { describe, expect, it } from 'vitest'
import { diffLineCount, diffTotals, parseUnifiedDiff } from './diff'

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ function a()
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5
@@ -20,2 +21,2 @@
 fim
-x
+y
`

describe('parseUnifiedDiff', () => {
  it('arquivo modificado: hunks, números de linha e contagens', () => {
    const [f, ...rest] = parseUnifiedDiff(MODIFIED)
    expect(rest).toEqual([])
    expect(f).toMatchObject({
      path: 'src/a.ts',
      status: 'modified',
      binary: false,
      additions: 3,
      deletions: 2
    })
    expect(f?.hunks).toHaveLength(2)
    expect(f?.hunks[0]?.header).toBe('@@ -1,4 +1,5 @@ function a()')
    expect(f?.hunks[0]?.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'const a = 1' },
      { kind: 'del', oldNo: 2, newNo: null, text: 'const b = 2' },
      { kind: 'add', oldNo: null, newNo: 2, text: 'const b = 3' },
      { kind: 'add', oldNo: null, newNo: 3, text: 'const c = 4' },
      { kind: 'context', oldNo: 3, newNo: 4, text: 'const d = 5' }
    ])
    // Último hunk: o \n final do texto não vira linha de contexto.
    expect(f?.hunks[1]?.lines).toHaveLength(3)
    expect(diffLineCount(f!)).toBe(8)
  })

  it('arquivo novo e arquivo removido', () => {
    const files = parseUnifiedDiff(`diff --git a/n.txt b/n.txt
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/n.txt
@@ -0,0 +1,2 @@
+um
+dois
diff --git a/old.txt b/old.txt
deleted file mode 100644
index abc1234..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-tchau
`)
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['n.txt', 'added', 2, 0],
      ['old.txt', 'deleted', 0, 1]
    ])
  })

  it('renomeado (com e sem mudanças) e binário', () => {
    const files = parseUnifiedDiff(`diff --git a/a.ts b/b.ts
similarity index 100%
rename from a.ts
rename to b.ts
diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`)
    expect(files[0]).toMatchObject({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed', hunks: [] })
    expect(files[1]).toMatchObject({ path: 'logo.png', binary: true, hunks: [] })
  })

  it('"No newline" não vira linha e nomes entre aspas ficam legíveis', () => {
    const [f] = parseUnifiedDiff(`diff --git "a/p\\"q.txt" "b/p\\"q.txt"
index 1..2 100644
--- "a/p\\"q.txt"
+++ "b/p\\"q.txt"
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
\\ No newline at end of file
`)
    expect(f?.path).toBe('p"q.txt')
    expect(f?.hunks[0]?.lines.map((l) => l.kind)).toEqual(['del', 'add'])
  })

  it('texto vazio, sem diff ou cortado no meio não lança', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('Sem diferenças')).toEqual([])
    const cut = parseUnifiedDiff(MODIFIED.slice(0, MODIFIED.indexOf('const d') + 4))
    expect(cut).toHaveLength(1)
    expect(cut[0]?.hunks[0]?.lines.at(-1)).toMatchObject({ kind: 'context', text: 'cons' })
  })

  it('totais', () => {
    expect(diffTotals(parseUnifiedDiff(MODIFIED))).toEqual({ files: 1, additions: 3, deletions: 2 })
  })
})
