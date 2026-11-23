import { Fragment, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
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
    <HStack gap={2} vAlign="center">
      <Text type="supporting" className="orkio-diff-stat-add" hasTabularNumbers>
        +{file.additions}
      </Text>
      <Text type="supporting" className="orkio-diff-stat-del" hasTabularNumbers>
        −{file.deletions}
      </Text>
    </HStack>
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
    return <Text type="supporting">Arquivo binário: o conteúdo não aparece aqui.</Text>
  if (file.hunks.length === 0) {
    return (
      <Text type="supporting">
        {file.status === 'renamed'
          ? 'Só renomeado, sem mudanças no conteúdo.'
          : 'Sem mudanças de conteúdo.'}
      </Text>
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
      <VStack key={hi}>
        <Text as="div" type="code" className="orkio-diff-hunk">
          {hunk.header}
        </Text>
        {lines.map((line, li) => {
          const no = line.kind === 'del' ? line.oldNo : line.newNo
          return (
            <Text
              as="div"
              type="code"
              key={li}
              className={`orkio-diff-line orkio-diff-${line.kind}`}
            >
              <Text as="span" type="inherit" className="orkio-diff-no">
                {no}
              </Text>
              <Text as="span" type="inherit" className="orkio-diff-sign">
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
              </Text>
              <Text as="span" type="inherit">
                {line.text === '' ? ' ' : line.text}
              </Text>
            </Text>
          )
        })}
      </VStack>
    )
  }
  const shown = ROWS_FIRST + extra
  return (
    <VStack gap={2}>
      <VStack className="orkio-diff" role="group" aria-label={`Mudanças em ${file.path}`}>
        {hunks}
      </VStack>
      {total > shown && (
        <HStack>
          <Button
            size="sm"
            variant="ghost"
            label={`Mostrar mais ${Math.min(ROWS_MORE, total - shown)} linhas (faltam ${total - shown})`}
            onClick={onMore}
          />
        </HStack>
      )}
    </VStack>
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
    <VStack gap={3} role="region" aria-label={label}>
      {empty && <Text type="supporting">Sem diferenças em relação à base.</Text>}

      {files.length > 0 && (
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Text type="supporting" color="primary">
            {plural(totals.files, 'arquivo alterado', 'arquivos alterados')}
          </Text>
          <Text type="supporting" className="orkio-diff-stat-add" hasTabularNumbers>
            +{totals.additions}
          </Text>
          <Text type="supporting" className="orkio-diff-stat-del" hasTabularNumbers>
            −{totals.deletions}
          </Text>
          {files.length > 1 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                label="Expandir tudo"
                onClick={() => setAll(true)}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Recolher tudo"
                onClick={() => setAll(false)}
              />
            </>
          )}
        </HStack>
      )}

      {files.length === 0 && !onlyUncommitted && diff.trim() !== '' && (
        // Texto que não é diff unificado: mostra como veio.
        <Text as="div" type="code" className="orkio-codeblock">
          {diff}
        </Text>
      )}

      {uncommitted && uncommitted.length > 0 && (
        <VStack gap={1} role="group" aria-label="Ainda sem commit">
          <Text type="supporting" color="primary">
            Ainda sem commit ({uncommitted.length})
          </Text>
          {uncommitted.slice(0, UNCOMMITTED_SHOWN).map((f) => (
            <HStack key={f.path} gap={2} vAlign="center">
              <Token size="sm" label={UNCOMMITTED_LABEL[f.status]} color="default" />
              <Code size="inherit">{f.path}</Code>
            </HStack>
          ))}
          {uncommitted.length > UNCOMMITTED_SHOWN && (
            <Text type="supporting">+{uncommitted.length - UNCOMMITTED_SHOWN} arquivos</Text>
          )}
        </VStack>
      )}

      {files.map((file, index) => (
        <Collapsible
          key={`${file.path}:${index}`}
          chevronPosition="start"
          isOpen={isOpen(file, index)}
          onOpenChange={(value) => setOpen((o) => ({ ...o, [file.path]: value }))}
          trigger={
            <HStack gap={2} vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <Text type="supporting" color="primary">
                  {file.oldPath ? (
                    <>
                      <Code size="inherit">{file.oldPath}</Code> →{' '}
                    </>
                  ) : null}
                  <Code size="inherit">{file.path}</Code>
                </Text>
              </StackItem>
              {STATUS_LABEL[file.status] && (
                <Token size="sm" label={STATUS_LABEL[file.status]!} color="default" />
              )}
              {uncommitted && !onlyUncommitted && dirty.has(file.path) && (
                <Token size="sm" label="sem commit" color="default" />
              )}
              <FileStat file={file} />
            </HStack>
          }
        >
          {isOpen(file, index) && (
            <FileBody
              file={file}
              extra={more[file.path] ?? 0}
              onMore={() =>
                setMore((m) => ({ ...m, [file.path]: (m[file.path] ?? 0) + ROWS_MORE }))
              }
            />
          )}
        </Collapsible>
      ))}

      {truncated && (
        <Text type="supporting">
          O diff passou do limite e foi cortado. Abra a pasta de trabalho no editor para ver o
          resto.
        </Text>
      )}
      {!uncommitted && untracked.length > 0 && (
        <Text type="supporting">
          Arquivos novos fora do git (não entram no diff):{' '}
          {untracked.map((f, i) => (
            <Fragment key={f}>
              {i > 0 ? ', ' : ''}
              <Code size="inherit">{f}</Code>
            </Fragment>
          ))}
        </Text>
      )}
    </VStack>
  )
}
