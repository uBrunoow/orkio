import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { Selector } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  BoardSaveInput,
  BoardView,
  NotionResult,
  OrkioStageChoice
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '../../components/icons'

interface DraftStage {
  key: string
  id: string | null
  name: string
  /** Id da opção de status; `null` = não existe no Notion (bloqueia salvar). */
  optionId: string | null
  missingName: string | null
}

const ORKIO_STAGE = 'Etapa Orkio'

/** Criar/ajustar o quadro: etapas ↔ status do Notion, "Etapa Orkio" e "Bloqueada". */
export function BoardSettings({
  view,
  onSave,
  onCancel
}: {
  view: BoardView
  onSave(input: BoardSaveInput): Promise<NotionResult<BoardView>>
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
    ...(stages.length === 0 ? ['Adicione pelo menos uma etapa.'] : []),
    ...(stages.some((s) => !s.name.trim()) ? ['Toda etapa precisa de um nome.'] : []),
    ...(stages.some((s) => !s.optionId)
      ? ['Escolha uma opção de status do Notion que exista para cada etapa.']
      : []),
    ...(orkioMode === 'existing' && !orkioProperty
      ? ['Escolha a propriedade da Etapa Orkio.']
      : []),
    ...(orkioMode === 'create' && !confirmCreate
      ? ['Confirme a criação da propriedade “Etapa Orkio”.']
      : []),
    ...(missingOptions.length > 0 && !addMissing
      ? ['Confirme adicionar as opções que faltam na Etapa Orkio.']
      : [])
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
      stages: stages.map((s) => ({ id: s.id, name: s.name.trim(), notionStatusId: s.optionId! })),
      orkioStage,
      addMissingOptions: addMissing,
      blockedPropertyId: blockedProperty
    })
    setSaving(false)
    if (!result.ok) setError(result.error.message)
  }

  const statusOptions = view.statusOptions.map((o) => ({ value: o.id, label: o.name }))

  return (
    <Card role="region" aria-labelledby="board-settings-title">
      <VStack gap={5}>
        <VStack gap={1}>
          <Heading level={2} id="board-settings-title">
            {view.config ? 'Ajustar quadro' : 'Criar o quadro'}
          </Heading>
          <Text color="secondary">
            Cada etapa do Orkio corresponde a uma opção do status das Tarefas no Notion. Várias
            etapas podem usar a mesma opção (ex.: Revisando e Revisado → “Em andamento”).
          </Text>
        </VStack>

        <VStack gap={3} role="list" aria-label="Etapas">
          {stages.map((stage, index) => (
            <HStack key={stage.key} gap={2} vAlign="start" role="listitem">
              <StackItem size="fill">
                <TextInput
                  label={`Nome da etapa ${index + 1}`}
                  value={stage.name}
                  onChange={(value) => update(stage.key, { name: value })}
                />
              </StackItem>
              <StackItem size="fill">
                <Selector
                  label={`Status no Notion da etapa ${index + 1}`}
                  options={statusOptions}
                  placeholder="Escolha a opção"
                  {...(stage.optionId ? { value: stage.optionId } : {})}
                  {...(!stage.optionId
                    ? {
                        status: {
                          type: 'error' as const,
                          message: stage.missingName
                            ? `“${stage.missingName}” não existe no Notion.`
                            : 'Escolha uma opção.'
                        }
                      }
                    : {})}
                  onChange={(value: string) =>
                    update(stage.key, { optionId: value, missingName: null })
                  }
                />
              </StackItem>
              <HStack gap={1} vAlign="center">
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Subir ${stage.name || `etapa ${index + 1}`}`}
                  icon={<Icon icon={ArrowUpIcon} />}
                  isDisabled={index === 0}
                  onClick={() => index > 0 && moveStage(index, -1)}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Descer ${stage.name || `etapa ${index + 1}`}`}
                  icon={<Icon icon={ArrowDownIcon} />}
                  isDisabled={index === stages.length - 1}
                  onClick={() => index < stages.length - 1 && moveStage(index, 1)}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Remover ${stage.name || `etapa ${index + 1}`}`}
                  icon={<Icon icon={TrashIcon} />}
                  onClick={() => setStages((list) => list.filter((s) => s.key !== stage.key))}
                />
              </HStack>
            </HStack>
          ))}
          <HStack>
            <Button
              size="sm"
              label="Adicionar etapa"
              icon={<Icon icon={PlusIcon} />}
              onClick={() =>
                setStages((list) => [
                  ...list,
                  { key: `n${Date.now()}`, id: null, name: '', optionId: null, missingName: null }
                ])
              }
            />
          </HStack>
        </VStack>

        <VStack gap={3}>
          <RadioList
            label="Mostrar a etapa do Orkio no Notion"
            description="Opcional: grava a etapa fina (ex.: Revisando) numa propriedade de seleção das Tarefas."
            value={orkioMode}
            onChange={(value) => setOrkioMode(value as OrkioStageChoice['mode'])}
          >
            <RadioListItem value="none" label="Não mostrar" />
            <RadioListItem
              value="existing"
              label="Usar uma propriedade de seleção existente"
              isDisabled={view.selectProperties.length === 0}
            />
            <RadioListItem
              value="create"
              label="Criar a propriedade “Etapa Orkio”"
              isDisabled={hasOrkioProperty}
              {...(hasOrkioProperty ? { description: 'Já existe: use “existente”.' } : {})}
            />
          </RadioList>
          {orkioMode === 'existing' && (
            <Selector
              label="Propriedade da Etapa Orkio"
              options={view.selectProperties.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Escolha a propriedade"
              {...(orkioProperty ? { value: orkioProperty } : {})}
              onChange={(value: string) => {
                setOrkioProperty(value)
                setAddMissing(false)
              }}
            />
          )}
          {missingOptions.length > 0 && (
            <CheckboxInput
              label={`Adicionar no Notion as opções que faltam: ${missingOptions.join(', ')}`}
              value={addMissing}
              onChange={setAddMissing}
            />
          )}
          {orkioMode === 'create' && (
            <CheckboxInput
              label="Confirmo criar a propriedade “Etapa Orkio” no banco de Tarefas (vale para todas as tarefas do banco)"
              value={confirmCreate}
              onChange={setConfirmCreate}
            />
          )}
        </VStack>

        <Selector
          label="Bloqueada"
          description="Opcional: sincroniza a marcação com uma caixa de seleção do Notion. Sem isso, fica só neste computador."
          options={view.checkboxProperties.map((p) => ({ value: p.id, label: p.name }))}
          placeholder={
            view.checkboxProperties.length === 0
              ? 'Nenhuma caixa de seleção no banco'
              : 'Só neste computador'
          }
          isOptional
          hasClear
          isDisabled={view.checkboxProperties.length === 0}
          value={blockedProperty}
          onChange={(value: string | null) => setBlockedProperty(value)}
        />

        {error && <Alert tone="danger">{error}</Alert>}
        {blockers.length > 0 && <Text type="supporting">{blockers.join(' ')}</Text>}
        <HStack gap={2}>
          <Button
            variant="primary"
            label={view.config ? 'Salvar quadro' : 'Criar quadro'}
            isLoading={saving}
            isDisabled={blockers.length > 0}
            onClick={() => void save()}
          />
          {onCancel && <Button variant="ghost" label="Cancelar" onClick={onCancel} />}
        </HStack>
      </VStack>
    </Card>
  )
}
