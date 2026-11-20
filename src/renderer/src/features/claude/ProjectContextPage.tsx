import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { CONTEXT_LIMITS, type ProjectClaudeContext } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { NotionLogo, TrashIcon } from '../../components/icons'

/**
 * Contexto do Claude Code do projeto (4B): instruções fixas + páginas de referência do Notion.
 * Vai no briefing de toda execução, dentro de um limite de tamanho (o que passar é cortado com aviso).
 */
export function ProjectContextPage({
  projectId,
  onClose
}: {
  projectId: string
  onClose(): void
}): React.JSX.Element {
  const [ctx, setCtx] = useState<ProjectClaudeContext | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string }[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.claude.getContext(projectId).then((r) => {
      if (!active) return
      if (r.ok) setCtx(r.value)
      else setMessage({ tone: 'error', text: r.error.message })
    })
    return () => {
      active = false
    }
  }, [projectId])

  if (!ctx) return <Skeleton height={240} aria-label="Carregando contexto" />

  const search = async (): Promise<void> => {
    setSearching(true)
    const r = await window.orkio.claude.searchPages(query)
    setSearching(false)
    if (r.ok) setResults(r.value)
    else setMessage({ tone: 'error', text: r.error.message })
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    const r = await window.orkio.claude.saveContext(projectId, ctx)
    setSaving(false)
    setMessage(
      r.ok ? { tone: 'ok', text: 'Contexto salvo.' } : { tone: 'error', text: r.error.message }
    )
  }
  const full = ctx.notionPages.length >= CONTEXT_LIMITS.pages
  const chosen = new Set(ctx.notionPages.map((p) => p.id))

  return (
    <VStack gap={5} maxWidth={880} role="region" aria-label="Contexto do Claude Code">
      <PageHeader
        title="Contexto do Claude Code"
        subtitle="Vai no briefing de toda execução deste projeto, antes da descrição da tarefa."
      />
      <TextArea
        label="Instruções"
        description="Convenções, comandos de teste, o que evitar. Fica só no seu computador."
        value={ctx.instructions}
        maxLength={CONTEXT_LIMITS.instructions}
        rows={8}
        onChange={(instructions) => setCtx({ ...ctx, instructions })}
      />

      <VStack gap={2}>
        <Text weight="semibold">Páginas de referência do Notion</Text>
        <Text type="supporting">
          Até {CONTEXT_LIMITS.pages} páginas, lidas na hora de rodar. O Orkio guarda só o id e o
          nome. Contexto acima de {CONTEXT_LIMITS.total.toLocaleString('pt-BR')} caracteres é
          cortado, com aviso antes de rodar.
        </Text>
        {ctx.notionPages.length > 0 && (
          <List hasDividers density="compact" aria-label="Páginas de referência">
            {ctx.notionPages.map((p) => (
              <Item
                as="li"
                key={p.id}
                label={p.name}
                startContent={<Icon icon={NotionLogo} size="sm" />}
                endContent={
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Remover ${p.name}`}
                    isIconOnly
                    icon={<Icon icon={TrashIcon} />}
                    onClick={() =>
                      setCtx({
                        ...ctx,
                        notionPages: ctx.notionPages.filter((x) => x.id !== p.id)
                      })
                    }
                  />
                }
              />
            ))}
          </List>
        )}
        <Card variant="transparent">
          <VStack gap={2}>
            <HStack gap={2} vAlign="end">
              <StackItem size="fill">
                <TextInput
                  type="search"
                  label="Buscar página no Notion"
                  placeholder="Título da página"
                  value={query}
                  onChange={setQuery}
                />
              </StackItem>
              <Button
                label="Buscar"
                isLoading={searching}
                isDisabled={full}
                {...(full ? { disabledMessage: 'Limite de páginas atingido.' } : {})}
                onClick={() => void search()}
              />
            </HStack>
            {results !== null &&
              (results.length === 0 ? (
                <Text type="supporting">
                  Nenhuma página encontrada. Ela precisa estar compartilhada com o Orkio.
                </Text>
              ) : (
                <List hasDividers density="compact" aria-label="Resultados da busca">
                  {results.map((p) => (
                    <Item
                      as="li"
                      key={p.id}
                      label={p.name}
                      endContent={
                        <Button
                          size="sm"
                          variant="secondary"
                          label={chosen.has(p.id) ? 'Adicionada' : 'Adicionar'}
                          aria-label={`Adicionar ${p.name}`}
                          isDisabled={chosen.has(p.id) || full}
                          onClick={() => setCtx({ ...ctx, notionPages: [...ctx.notionPages, p] })}
                        />
                      }
                    />
                  ))}
                </List>
              ))}
          </VStack>
        </Card>
      </VStack>

      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <Text role="status">{message.text}</Text>
        ))}
      <HStack gap={2}>
        <Button
          variant="primary"
          label="Salvar contexto"
          isLoading={saving}
          onClick={() => void save()}
        />
        <Button variant="ghost" label="Voltar ao quadro" onClick={onClose} />
      </HStack>
    </VStack>
  )
}
