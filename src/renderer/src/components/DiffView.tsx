import { Fragment, useMemo, useState } from 'react'
import { IconChevronRight } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { UncommittedFile, UncommittedStatus } from '../../../shared/agent-run'
import {
  diffLineCount,
  diffTotals,
  parseUnifiedDiff,
  type DiffFile,
  type DiffFileStatus
} from '../lib/diff'
import { plural } from '../lib/format'

/** Quantos arquivos abrem sozinhos, e até quantas linhas cada um (o resto fica recolhido). */
const AUTO_OPEN_FILES = 3
const AUTO_OPEN_LINES = 200
/** Linhas mostradas por arquivo antes de "Mostrar mais"; cada clique revela outro bloco. */
const ROWS_FIRST = 300
const ROWS_MORE = 500

const STATUS_LABEL: Record<DiffFileStatus, string | null> = {
  modified: null,
  added: 'novo',
  deleted: 'removido',
  renamed: 'renomeado'
}

const UNCOMMITTED_LABEL: Record<UncommittedStatus, string> = {
  modified: 'modificado',
  added: 'novo',
  deleted: 'removido',
  renamed: 'renomeado',
  untracked: 'fora do git'
}
/** Quantos arquivos da lista "Ainda sem commit" aparecem antes de "+N". */
const UNCOMMITTED_SHOWN = 30

function FileStat({ file }: { file: DiffFile }): React.JSX.Element {
  return (
    <span className="tabular flex items-center gap-2 font-mono text-xs">
      <span className="text-ok">+{file.additions}</span>
      <span className="text-danger">−{file.deletions}</span>
    </span>
  )
}

function FileBody({
  file,
  extra,
  onMore
}: {
  file: DiffFile
  /** Linhas extras já reveladas com "Mostrar mais". */
  extra: number
  onMore(): void
}): React.JSX.Element {
  if (file.binary)
    return (
      <p className="text-xs text-muted-foreground">Arquivo binário: o conteúdo não aparece aqui.</p>
    )
  if (file.hunks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {file.status === 'renamed'
          ? 'Só renomeado, sem mudanças no conteúdo.'
          : 'Sem mudanças de conteúdo.'}
      </p>
    )
  }
  const total = diffLineCount(file)
  let budget = ROWS_FIRST + extra
  const hunks: React.JSX.Element[] = []
  for (const [hi, hunk] of file.hunks.entries()) {
    if (budget <= 0) break
    const lines = hunk.lines.slice(0, budget)
    budget -= lines.length
    hunks.push(
      <div key={hi} className="flex flex-col">
        <div className="orkio-diff-hunk text-xs">{hunk.header}</div>
        {lines.map((line, li) => {
          const no = line.kind === 'del' ? line.oldNo : line.newNo
          return (
            <div key={li} className={`orkio-diff-line orkio-diff-${line.kind} text-xs`}>
              <span className="orkio-diff-no">{no}</span>
              <span className="orkio-diff-sign">
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
              </span>
              <span>{line.text === '' ? ' ' : line.text}</span>
            </div>
          )
        })}
      </div>
    )
  }
  const shown = ROWS_FIRST + extra
  return (
    <div className="flex flex-col gap-2">
      <div
        className="orkio-diff flex flex-col"
        role="group"
        aria-label={`Mudanças em ${file.path}`}
      >
        {hunks}
      </div>
      {total > shown && (
        <div>
          <Button size="sm" variant="ghost" onClick={onMore}>
            {`Mostrar mais ${Math.min(ROWS_MORE, total - shown)} linhas (faltam ${total - shown})`}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Diff do ambiente da tarefa: resumo (arquivos, +/−), um cartão por arquivo com as linhas
 * coloridas e o número da linha, e os arquivos novos que ainda estão fora do git. Só leitura.
 */
export function DiffView({
  label,
  diff,
  truncated = false,
  untracked = [],
  uncommitted,
  onlyUncommitted = false
}: {
  label: string
  diff: string
  /** O main cortou o texto no limite. */
  truncated?: boolean
  /** Arquivos novos fora do git (não entram no `git diff`). */
  untracked?: readonly string[]
  /**
   * Arquivos que ainda estão fora de commit: aparecem numa lista ("Ainda sem commit") e marcam o
   * cartão do arquivo. Substitui a nota dos arquivos fora do git.
   */
  uncommitted?: readonly UncommittedFile[]
  /** Mostra só os arquivos que estão fora de commit (com `uncommitted`). */
  onlyUncommitted?: boolean
}): React.JSX.Element {
  const dirty = useMemo(
    () => new Map((uncommitted ?? []).map((f) => [f.path, f.status])),
    [uncommitted]
  )
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff])
  const files = useMemo(
    () => (onlyUncommitted ? parsed.filter((f) => dirty.has(f.path)) : parsed),
    [parsed, dirty, onlyUncommitted]
  )
  const totals = diffTotals(files)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [more, setMore] = useState<Record<string, number>>({})
  const isOpen = (file: DiffFile, index: number): boolean =>
    open[file.path] ?? (index < AUTO_OPEN_FILES && diffLineCount(file) <= AUTO_OPEN_LINES)
  const setAll = (value: boolean): void =>
    setOpen(Object.fromEntries(files.map((f) => [f.path, value])))

  const empty =
    files.length === 0 &&
    untracked.length === 0 &&
    dirty.size === 0 &&
    (onlyUncommitted || diff.trim() === '')
  return (
    <section className="flex flex-col gap-3" role="region" aria-label={label}>
      {empty && <p className="text-xs text-muted-foreground">Sem diferenças em relação à base.</p>}

      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span>{plural(totals.files, 'arquivo alterado', 'arquivos alterados')}</span>
          <span className="tabular font-mono text-ok">+{totals.additions}</span>
          <span className="tabular font-mono text-danger">−{totals.deletions}</span>
          {files.length > 1 && (
            <>
              <Button size="xs" variant="ghost" onClick={() => setAll(true)}>
                Expandir tudo
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setAll(false)}>
                Recolher tudo
              </Button>
            </>
          )}
        </div>
      )}

      {files.length === 0 && !onlyUncommitted && diff.trim() !== '' && (
        // Texto que não é diff unificado: mostra como veio.
        <pre className="orkio-codeblock text-xs">{diff}</pre>
      )}

      {uncommitted && uncommitted.length > 0 && (
        <div className="flex flex-col gap-1" role="group" aria-label="Ainda sem commit">
          <p className="text-xs">Ainda sem commit ({uncommitted.length})</p>
          {uncommitted.slice(0, UNCOMMITTED_SHOWN).map((f) => (
            <div key={f.path} className="flex items-center gap-2 text-xs">
              <Badge variant="outline">{UNCOMMITTED_LABEL[f.status]}</Badge>
              <code className="font-mono">{f.path}</code>
            </div>
          ))}
          {uncommitted.length > UNCOMMITTED_SHOWN && (
            <p className="text-xs text-muted-foreground">
              +{uncommitted.length - UNCOMMITTED_SHOWN} arquivos
            </p>
          )}
        </div>
      )}

      {files.map((file, index) => {
        const opened = isOpen(file, index)
        return (
          <Collapsible
            key={`${file.path}:${index}`}
            open={opened}
            onOpenChange={(value) => setOpen((o) => ({ ...o, [file.path]: value }))}
            className="rounded-lg border border-border-soft bg-surface"
          >
            <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40">
              <IconChevronRight
                aria-hidden="true"
                className={cn(
                  'size-3.5 text-subtle-foreground transition-transform',
                  opened && 'rotate-90'
                )}
              />
              <span className="min-w-0 flex-1 truncate font-mono">
                {file.oldPath ? `${file.oldPath} → ` : ''}
                {file.path}
              </span>
              {STATUS_LABEL[file.status] && (
                <Badge variant="outline">{STATUS_LABEL[file.status]}</Badge>
              )}
              {uncommitted && !onlyUncommitted && dirty.has(file.path) && (
                <Badge variant="outline">sem commit</Badge>
              )}
              <FileStat file={file} />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border-soft p-2">
              {opened && (
                <FileBody
                  file={file}
                  extra={more[file.path] ?? 0}
                  onMore={() =>
                    setMore((m) => ({ ...m, [file.path]: (m[file.path] ?? 0) + ROWS_MORE }))
                  }
                />
              )}
            </CollapsibleContent>
          </Collapsible>
        )
      })}

      {truncated && (
        <p className="text-xs text-muted-foreground">
          O diff passou do limite e foi cortado. Abra a pasta de trabalho no editor para ver o
          resto.
        </p>
      )}
      {!uncommitted && untracked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Arquivos novos fora do git (não entram no diff):{' '}
          {untracked.map((f, i) => (
            <Fragment key={f}>
              {i > 0 ? ', ' : ''}
              <code className="font-mono text-foreground">{f}</code>
            </Fragment>
          ))}
        </p>
      )}
    </section>
  )
}
