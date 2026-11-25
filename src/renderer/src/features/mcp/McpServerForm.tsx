import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChoiceCards } from '../../components/ChoiceCards'
import { SegmentedControl, SelectField, TextAreaField, TextField } from '../../components/form'
import { Alert } from '../../components/Alert'
import { PlusIcon, TrashIcon } from '../../components/icons'
import { isSensitiveName, MCP_LIMITS, type McpServer } from '../../../../shared/mcp'
import {
  checkDraft,
  draftHasProblems,
  emptyBinding,
  type BindingDraft,
  type ServerDraft
} from './mcp-logic'
import { SURFACE } from '../../components/surface'

/**
 * Formulário do servidor (Avançado): nome, comando + argumentos ou endereço, variáveis/cabeçalhos
 * com valor = texto ou segredo (nome sensível só aceita segredo). Valida igual ao main.
 */
export function McpServerForm({
  title,
  initial,
  secretNames,
  submitLabel,
  build,
  onSave,
  onCancel,
  bare = false
}: {
  title: string
  /** Sem a moldura nem o título (dentro de um modal, que já tem os dois). */
  bare?: boolean
  initial: ServerDraft
  secretNames: readonly string[]
  submitLabel: string
  /** Rascunho → servidor (`null` = não passou na regra do main). */
  build(draft: ServerDraft): McpServer | null
  onSave(server: McpServer): Promise<string | null>
  onCancel(): void
}): React.JSX.Element {
  const [d, setD] = useState<ServerDraft>(initial)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const check = checkDraft(d)
  const show = (problem: string | null): string | null => (tried ? problem : null)
  const set = (patch: Partial<ServerDraft>): void => setD((c) => ({ ...c, ...patch }))

  const submit = async (): Promise<void> => {
    setTried(true)
    setError(null)
    if (draftHasProblems(check)) return
    const server = build(d)
    if (!server) {
      setError('Confira os campos: algo não passou na validação.')
      return
    }
    setSaving(true)
    const problem = await onSave(server)
    setSaving(false)
    if (problem) setError(problem)
  }

  return (
    <form
      aria-label={title}
      className={bare ? 'flex flex-col gap-4' : SURFACE.section}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {!bare && <h3 className="text-sm font-medium">{title}</h3>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome"
          value={d.name}
          maxLength={MCP_LIMITS.name}
          placeholder="Ex.: Meu servidor"
          onChange={(name) => set({ name })}
          error={show(check.name)}
        />
        <TextField
          label="O que faz (opcional)"
          value={d.description}
          maxLength={MCP_LIMITS.description}
          placeholder="Uma frase: o que ele deixa o agente fazer"
          onChange={(description) => set({ description })}
        />
      </div>
      <ChoiceCards
        label="Como ele roda"
        columns={2}
        value={d.transport}
        onChange={(transport) => set({ transport })}
        options={[
          {
            value: 'stdio',
            title: 'Comando neste computador',
            phrase: 'O Orkio inicia um programa (ex.: npx pacote).',
            hint: 'stdio'
          },
          {
            value: 'http',
            title: 'Endereço na internet',
            phrase: 'O Claude Code conecta num servidor já rodando.',
            hint: 'http'
          }
        ]}
      />
      {d.transport === 'stdio' ? (
        <>
          <TextField
            label="Comando"
            mono
            value={d.command}
            placeholder="npx"
            onChange={(command) => set({ command })}
            description="Só o programa (nome no PATH ou caminho absoluto). Nunca uma linha de shell."
            error={show(check.command)}
          />
          <TextAreaField
            label="Argumentos"
            mono
            rows={3}
            value={d.argsText}
            placeholder={'-y\n@pacote/servidor-mcp'}
            onChange={(argsText) => set({ argsText })}
            description="Um por linha."
            error={show(check.args)}
          />
          <BindingsEditor
            title="Variáveis de ambiente"
            addLabel="Adicionar variável"
            target="env"
            list={d.env}
            problems={tried ? check.env : []}
            secretNames={secretNames}
            onChange={(env) => set({ env })}
          />
        </>
      ) : (
        <>
          <TextField
            label="Endereço"
            mono
            type="url"
            value={d.url}
            placeholder="https://exemplo.com/mcp"
            onChange={(url) => set({ url })}
            error={show(check.url)}
          />
          <BindingsEditor
            title="Cabeçalhos"
            addLabel="Adicionar cabeçalho"
            target="header"
            list={d.headers}
            problems={tried ? check.headers : []}
            secretNames={secretNames}
            onChange={(headers) => set({ headers })}
          />
        </>
      )}
      {tried && check.general && <Alert tone="danger">{check.general}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Salvando…' : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function BindingsEditor({
  title,
  addLabel,
  target,
  list,
  problems,
  secretNames,
  onChange
}: {
  title: string
  addLabel: string
  target: 'env' | 'header'
  list: BindingDraft[]
  problems: (string | null)[]
  secretNames: readonly string[]
  onChange(list: BindingDraft[]): void
}): React.JSX.Element {
  const update = (i: number, patch: Partial<BindingDraft>): void =>
    onChange(list.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      <p className="-mt-1 text-xs text-muted-foreground">
        Valor sensível (token, chave, senha) só por segredo: o valor nunca fica na config.
      </p>
      {list.map((b, i) => {
        const sensitive = isSensitiveName(b.name)
        const kind = sensitive ? 'secret' : b.kind
        const label = b.name.trim() || `${target === 'env' ? 'Variável' : 'Cabeçalho'} ${i + 1}`
        return (
          <div
            key={i}
            role="group"
            aria-label={label}
            className="flex flex-col gap-2 rounded-lg border border-border-soft bg-surface p-3"
          >
            <div className="flex flex-wrap items-end gap-2">
              <TextField
                label="Nome"
                mono
                size="sm"
                value={b.name}
                placeholder={target === 'env' ? 'API_KEY' : 'Authorization'}
                onChange={(name) =>
                  update(i, isSensitiveName(name) ? { name, kind: 'secret', text: '' } : { name })
                }
                className="min-w-40 flex-1"
              />
              <SegmentedControl
                label={`Valor de ${label}`}
                size="sm"
                value={kind}
                onChange={(v) => update(i, { kind: v === 'secret' ? 'secret' : 'text' })}
                options={
                  sensitive
                    ? [{ value: 'secret', label: 'Segredo' }]
                    : [
                        { value: 'text', label: 'Texto' },
                        { value: 'secret', label: 'Segredo' }
                      ]
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Tirar ${label}`}
                onClick={() => onChange(list.filter((_, j) => j !== i))}
              >
                <TrashIcon />
              </Button>
            </div>
            {kind === 'text' ? (
              <TextField
                label="Valor"
                mono
                size="sm"
                value={b.text}
                onChange={(text) => update(i, { text })}
              />
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <SelectField
                  label="Segredo"
                  size="sm"
                  value={b.secret || null}
                  placeholder={secretNames.length ? 'Escolha o segredo' : 'Nenhum segredo guardado'}
                  options={secretNames.map((n) => ({ value: n, label: n }))}
                  onChange={(secret) => update(i, { secret })}
                  className="min-w-48 flex-1"
                />
                {target === 'header' && (
                  <TextField
                    label="Antes do valor"
                    mono
                    size="sm"
                    value={b.prefix}
                    placeholder="Bearer "
                    onChange={(prefix) => update(i, { prefix })}
                    inputClassName="w-28"
                  />
                )}
              </div>
            )}
            {problems[i] && <p className="text-xs text-danger">{problems[i]}</p>}
          </div>
        )
      })}
      <div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onChange([...list, emptyBinding()])}
        >
          <PlusIcon />
          {addLabel}
        </Button>
      </div>
    </fieldset>
  )
}
