import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { AlvaCheckItem, AlvaPrecheck } from '../../../../shared/alva'
import type { AlvaStatusView, BoardView } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { RefreshIcon } from '../../components/icons'

const STATE: Record<AlvaCheckItem['state'], { label: string; color: 'green' | 'red' | 'yellow' }> =
  {
    ok: { label: 'OK', color: 'green' },
    missing: { label: 'Falta', color: 'red' },
    warning: { label: 'Atenção', color: 'yellow' }
  }

const byName = (view: BoardView, re: RegExp): string | null =>
  view.config?.stages.find((s) => re.test(s.name))?.id ?? null

/**
 * Tela "alva-flow" (5B): pré-checagem do projeto, criação dos fluxos Alva (templates editáveis no
 * "Fluxos de tarefa"), coluna opcional "Planejando" e limite de fluxos Alva em paralelo.
 */
export function AlvaPage({
  projectId,
  view,
  onBoardChanged
}: {
  projectId: string
  view: BoardView
  onBoardChanged(): void
}): React.JSX.Element {
  const [precheck, setPrecheck] = useState<AlvaPrecheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<AlvaStatusView | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [planStatus, setPlanStatus] = useState<string>(
    view.statusOptions.find((o) => /andamento/i.test(o.name))?.id ?? view.statusOptions[0]?.id ?? ''
  )
  const [targets, setTargets] = useState({
    plan: byName(view, /planejando/i),
    deliver: byName(view, /em andamento/i),
    reviewed: byName(view, /^revisado$/i)
  })

  useEffect(() => {
    let active = true
    void window.orkio.alva.precheck(projectId).then((r) => {
      if (active && r.ok) setPrecheck(r.value)
    })
    void window.orkio.alva.status(projectId).then((r) => {
      if (active && r.ok) setStatus(r.value)
    })
    return () => {
      active = false
    }
  }, [projectId])

  const recheck = async (): Promise<void> => {
    setChecking(true)
    const r = await window.orkio.alva.precheck(projectId, { force: true })
    setChecking(false)
    if (r.ok) setPrecheck(r.value)
  }

  const stageOptions = [
    { value: '', label: 'Nenhuma (rodar à mão)' },
    ...(view.config?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
  ]
  const hasPlanning = (view.config?.stages ?? []).some((s) => /planejando/i.test(s.name))

  const create = async (): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.alva.createTemplates(projectId, targets)
    setBusy(false)
    if (r.ok) {
      setStatus(r.value)
      setMessage({
        tone: 'ok',
        text: 'Fluxos Alva criados. Edite em Fluxo do projeto → Fluxos de tarefa.'
      })
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  const addPlanning = async (): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.alva.addPlanningStage(projectId, planStatus)
    setBusy(false)
    if (r.ok) {
      setTargets((t) => ({ ...t, plan: r.value }))
      setMessage({ tone: 'ok', text: 'Coluna “Planejando” criada.' })
      onBoardChanged()
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  return (
    <VStack gap={5} maxWidth={920} role="region" aria-label="alva-flow">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={2}>alva-flow</Heading>
        {precheck?.pluginVersion && <Code>v{precheck.pluginVersion}</Code>}
      </HStack>
      <Text color="secondary">
        Os fluxos Alva rodam os comandos do plugin alva-flow (/spec, /plan, /implement, /review,
        /commit, /pr) nas colunas do quadro, ligando cada tarefa do Notion a uma task do Backlog.md.
      </Text>

      <VStack gap={2} role="region" aria-label="Pronto para o alva-flow?">
        <HStack gap={2} vAlign="center">
          <Heading level={3}>Pronto para o alva-flow?</Heading>
          {precheck && (
            <Token
              size="sm"
              color={precheck.ready ? 'green' : 'red'}
              label={precheck.ready ? 'Pronto' : 'Falta configurar'}
              data-testid="alva-ready"
            />
          )}
          <StackItem size="fill" />
          <Button
            size="sm"
            variant="ghost"
            label="Verificar de novo"
            icon={<Icon icon={RefreshIcon} />}
            isLoading={checking}
            onClick={() => void recheck()}
          />
        </HStack>
        {precheck === null ? (
          <Skeleton height={160} aria-label="Verificando o projeto" />
        ) : (
          <List hasDividers aria-label="Itens da pré-checagem">
            {precheck.items.map((i) => (
              <Item
                as="li"
                key={i.id}
                label={i.label}
                description={i.detail}
                startContent={
                  <Token size="sm" color={STATE[i.state].color} label={STATE[i.state].label} />
                }
                {...(i.fix && i.state !== 'ok' ? { endContent: <Code>{i.fix}</Code> } : {})}
              />
            ))}
          </List>
        )}
        {precheck && !precheck.ready && (
          <Text type="supporting">
            Enquanto faltar algo, os fluxos Alva não começam (o resto do Orkio funciona
            normalmente).
          </Text>
        )}
      </VStack>

      <Card role="region" aria-label="Fluxos Alva">
        <VStack gap={3}>
          <Heading level={3}>Fluxos Alva</Heading>
          {status && status.templates.length > 0 && (
            <List density="compact" aria-label="Fluxos Alva criados">
              {status.templates.map((t) => (
                <Item
                  as="li"
                  key={t.id}
                  label={t.name}
                  description={
                    t.stageId
                      ? `Coluna “${view.config?.stages.find((s) => s.id === t.stageId)?.name ?? '?'}”, ${t.mode === 'manual' ? 'manual' : 'ao entrar'}`
                      : 'Sem coluna (rodar à mão)'
                  }
                />
              ))}
            </List>
          )}

          {!hasPlanning && (
            <HStack gap={2} vAlign="end" wrap="wrap">
              <Selector
                label="Status do Notion da coluna “Planejando”"
                options={view.statusOptions.map((o) => ({ value: o.id, label: o.name }))}
                {...(planStatus ? { value: planStatus } : {})}
                onChange={setPlanStatus}
              />
              <Button
                variant="secondary"
                label="Criar coluna “Planejando”"
                isDisabled={!planStatus}
                isLoading={busy}
                onClick={() => void addPlanning()}
              />
            </HStack>
          )}

          <HStack gap={2} wrap="wrap">
            <Selector
              label="Coluna do “Alva: planejar”"
              options={stageOptions}
              value={targets.plan ?? ''}
              onChange={(v: string) => setTargets((t) => ({ ...t, plan: v || null }))}
            />
            <Selector
              label="Coluna do “Alva: implementar e entregar”"
              options={stageOptions}
              value={targets.deliver ?? ''}
              onChange={(v: string) => setTargets((t) => ({ ...t, deliver: v || null }))}
            />
            <Selector
              label="Coluna do “Alva: comentários da PR”"
              options={stageOptions}
              value={targets.reviewed ?? ''}
              onChange={(v: string) => setTargets((t) => ({ ...t, reviewed: v || null }))}
            />
          </HStack>
          <Text type="supporting">
            O “Alva: CI vermelho” fica sem coluna (rode à mão). Push e pedir review chegam na 5C:
            até lá, o fluxo para e pede para você fazer à mão.
          </Text>
          <HStack gap={2}>
            <Button
              variant="primary"
              label={
                status && status.templates.length > 0 ? 'Recriar fluxos Alva' : 'Criar fluxos Alva'
              }
              isLoading={busy}
              onClick={() => void create()}
            />
          </HStack>
        </VStack>
      </Card>

      {precheck?.hasDocker && status && (
        <Selector
          label="Fluxos Alva ao mesmo tempo neste projeto (Docker e portas)"
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
          value={String(status.maxParallel)}
          onChange={(v: string) =>
            void window.orkio.alva.setMaxParallel(projectId, Number(v)).then((r) => {
              if (r.ok) setStatus(r.value)
            })
          }
        />
      )}

      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <Text role="status">{message.text}</Text>
        ))}
    </VStack>
  )
}
