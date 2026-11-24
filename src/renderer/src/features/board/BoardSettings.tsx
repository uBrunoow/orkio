import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField, RadioListField, SelectField, TextField } from '@/components/form'
import { Alert } from '../../components/Alert'
import { Spinner } from '../../components/Spinner'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '../../components/icons'
import {
  BOARD_SETUP_MESSAGES as MSG,
  ORKIO_STAGE_PROPERTY_NAME as ORKIO_STAGE,
  type BoardSaveInput,
  type BoardView,
  type OrkioStageChoice,
  type StageRole
} from '../../../../shared/board'
import type { Result } from '../../../../shared/result'

interface DraftStage {
  key: string
  id: string | null
  name: string
  /** Id da opção de status; `null` = não existe no Notion (bloqueia salvar). */
  optionId: string | null
  /** Papel do template (quadro novo); etapas salvas mantêm o delas no main. */
  role?: StageRole
  missingName: string | null
}

export function BoardSettings({
  view,
  onSave,
  onCancel
}: {
  view: BoardView
  onSave(input: BoardSaveInput): Promise<Result<BoardView>>
  onCancel: (() => void) | undefined
}): React.JSX.Element {
  const source = view.config?.stages ?? view.suggestion ?? []
  let counter = 0
  const [stages, setStages] = useState<DraftStage[]>(() =>
    source.map((s) => {
      const option = s.notionStatus.id
        ? view.statusOptions.find((o) => o.id === s.notionStatus.id)
        : undefined
      return {
        key: `k${counter++}`,
        id: s.id,
        name: s.name,
        ...(s.role ? { role: s.role } : {}),
        optionId: option?.id ?? null,
        missingName: option ? null : s.notionStatus.name
      }
    })
  )
  const current = view.config?.orkioStageProperty
  const [orkioMode, setOrkioMode] = useState<OrkioStageChoice['mode']>(
    current ? 'existing' : 'none'
  )
  const [orkioProperty, setOrkioProperty] = useState<string | null>(current?.id ?? null)
  const [confirmCreate, setConfirmCreate] = useState(false)
  const [addMissing, setAddMissing] = useState(false)
  const [blockedProperty, setBlockedProperty] = useState<string | null>(
    view.config?.blockedProperty?.id ?? null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: string, patch: Partial<DraftStage>): void =>
    setStages((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  const moveStage = (index: number, delta: number): void =>
    setStages((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + delta, 0, item!)
      return next
    })

  const hasOrkioProperty = view.selectProperties.some((p) => p.name === ORKIO_STAGE)
  const chosenSelect = view.selectProperties.find((p) => p.id === orkioProperty)
  const missingOptions =
    orkioMode === 'existing' && chosenSelect
      ? [...new Set(stages.map((s) => s.name.trim()))].filter(
          (name) => name && !chosenSelect.options.some((o) => o.name === name)
        )
      : []

  const blockers = [
    ...(stages.length === 0 ? [MSG.noStages] : []),
    ...(stages.some((s) => !s.name.trim()) ? [MSG.stageNeedsName] : []),
    ...(stages.some((s) => !s.optionId) ? [MSG.stageNeedsOption] : []),
    ...(orkioMode === 'existing' && !orkioProperty ? [MSG.chooseOrkioProperty] : []),
    ...(orkioMode === 'create' && !confirmCreate ? [MSG.confirmCreateOrkioProperty] : []),
    ...(missingOptions.length > 0 && !addMissing ? [MSG.confirmMissingOptions] : [])
  ]

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const orkioStage: OrkioStageChoice =
      orkioMode === 'existing' && orkioProperty
        ? { mode: 'existing', propertyId: orkioProperty }
        : orkioMode === 'create'
          ? { mode: 'create' }
          : { mode: 'none' }
    const result = await onSave({
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        notionStatusId: s.optionId!,
        ...(s.role ? { role: s.role } : {})
      })),
      orkioStage,
      addMissingOptions: addMissing,
      blockedPropertyId: blockedProperty
    })
    setSaving(false)
    if (!result.ok) setError(result.error.message)
  }

  const statusOptions = view.statusOptions.map((o) => ({ value: o.id, label: o.name }))

  return (
    <section
      aria-labelledby="board-settings-title"
      className="flex flex-col gap-5 rounded-xl border border-border-soft bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="board-settings-title" className="text-lg font-medium">
          {view.config ? 'Ajustar quadro' : 'Criar o quadro'}
        </h2>
        <p className="text-sm text-muted-foreground">
          Cada etapa do Orkio corresponde a uma opção do status das Tarefas no Notion. Várias etapas
          podem usar a mesma opção (ex.: Revisando e Revisado → “Em andamento”).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <ul aria-label="Etapas" className="flex flex-col gap-3">
          {stages.map((stage, index) => (
            <li key={stage.key} className="flex items-start gap-2">
              <TextField
                className="flex-1"
                label={`Nome da etapa ${index + 1}`}
                value={stage.name}
                onChange={(value) => update(stage.key, { name: value })}
              />
              <SelectField
                className="flex-1"
                label={`Status no Notion da etapa ${index + 1}`}
                options={statusOptions}
                placeholder="Escolha a opção"
                value={stage.optionId}
                error={
                  stage.optionId
                    ? null
                    : stage.missingName
                      ? `“${stage.missingName}” não existe no Notion.`
                      : 'Escolha uma opção.'
                }
                onChange={(value) => update(stage.key, { optionId: value, missingName: null })}
              />
              <div className="mt-5 flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Subir ${stage.name || `etapa ${index + 1}`}`}
                  disabled={index === 0}
                  onClick={() => index > 0 && moveStage(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Descer ${stage.name || `etapa ${index + 1}`}`}
                  disabled={index === stages.length - 1}
                  onClick={() => index < stages.length - 1 && moveStage(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remover ${stage.name || `etapa ${index + 1}`}`}
                  onClick={() => setStages((list) => list.filter((s) => s.key !== stage.key))}
                >
                  <TrashIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setStages((list) => [
                ...list,
                { key: `n${Date.now()}`, id: null, name: '', optionId: null, missingName: null }
              ])
            }
          >
            <PlusIcon />
            Adicionar etapa
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <RadioListField
          label="Mostrar a etapa do Orkio no Notion"
          description="Opcional: grava a etapa fina (ex.: Revisando) numa propriedade de seleção das Tarefas."
          value={orkioMode}
          onChange={(value) => setOrkioMode(value as OrkioStageChoice['mode'])}
          options={[
            { value: 'none', label: 'Não mostrar' },
            {
              value: 'existing',
              label: 'Usar uma propriedade de seleção existente',
              disabled: view.selectProperties.length === 0
            },
            {
              value: 'create',
              label: `Criar a propriedade “${ORKIO_STAGE}”`,
              disabled: hasOrkioProperty,
              ...(hasOrkioProperty ? { description: 'Já existe: use “existente”.' } : {})
            }
          ]}
        />
        {orkioMode === 'existing' && (
          <SelectField
            label={`Propriedade da ${ORKIO_STAGE}`}
            options={view.selectProperties.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Escolha a propriedade"
            value={orkioProperty}
            onChange={(value) => {
              setOrkioProperty(value)
              setAddMissing(false)
            }}
          />
        )}
        {missingOptions.length > 0 && (
          <CheckboxField
            label={`Adicionar no Notion as opções que faltam: ${missingOptions.join(', ')}`}
            checked={addMissing}
            onChange={setAddMissing}
          />
        )}
        {orkioMode === 'create' && (
          <CheckboxField
            label={`Confirmo criar a propriedade “${ORKIO_STAGE}” no banco de Tarefas (vale para todas as tarefas do banco)`}
            checked={confirmCreate}
            onChange={setConfirmCreate}
          />
        )}
      </div>

      <SelectField
        label="Bloqueada"
        description="Opcional: sincroniza a marcação com uma caixa de seleção do Notion. Sem isso, fica só neste computador."
        options={view.checkboxProperties.map((p) => ({ value: p.id, label: p.name }))}
        placeholder={
          view.checkboxProperties.length === 0
            ? 'Nenhuma caixa de seleção no banco'
            : 'Só neste computador'
        }
        clearLabel="Só neste computador"
        onClear={() => setBlockedProperty(null)}
        disabled={view.checkboxProperties.length === 0}
        value={blockedProperty}
        onChange={(value) => setBlockedProperty(value)}
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {blockers.length > 0 && <p className="text-xs text-muted-foreground">{blockers.join(' ')}</p>}
      <div className="flex items-center gap-2">
        <Button disabled={saving || blockers.length > 0} onClick={() => void save()}>
          {saving && <Spinner />}
          {view.config ? 'Salvar quadro' : 'Criar quadro'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </section>
  )
}
