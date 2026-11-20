import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { HStack } from '@astryxdesign/core/HStack'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'

const OTHER = '__outro__'

interface Question {
  question: string
  options: string[]
  multiSelect: boolean
}

/**
 * Perguntas do Claude Code (AskUserQuestion): várias por chamada (o /spec do alva-flow manda até
 * 4), escolha única ou múltipla, e "Outro" com texto livre. A resposta de cada pergunta vai como
 * texto; múltiplas escolhas separadas por ", ".
 */
export function QuestionCard({
  questions,
  onAnswer
}: {
  questions: Question[]
  onAnswer(answers: Record<string, string>): void
}): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const answerOf = (q: Question): string => {
    const values = (picked[q.question] ?? []).map((v) =>
      v === OTHER ? (other[q.question] ?? '').trim() : v
    )
    return values.filter(Boolean).join(', ')
  }
  const complete = questions.every((q) => answerOf(q) !== '')

  return (
    <Card role="group" aria-label="Pergunta do Claude Code">
      <VStack gap={4}>
        {questions.length > 1 && (
          <Text type="supporting">{questions.length} perguntas — responda todas e envie.</Text>
        )}
        {questions.map((q, qi) => {
          const chosen = picked[q.question] ?? []
          const set = (values: string[]): void =>
            setPicked((prev) => ({ ...prev, [q.question]: values }))
          return (
            <VStack
              key={q.question}
              gap={2}
              role="group"
              aria-label={`Pergunta ${qi + 1}: ${q.question}`}
            >
              {q.multiSelect ? (
                <VStack gap={1}>
                  <Text weight="semibold">{q.question}</Text>
                  {[...q.options, OTHER].map((o) => (
                    <CheckboxInput
                      key={o}
                      label={o === OTHER ? 'Outro (escrever)' : o}
                      value={chosen.includes(o)}
                      onChange={(on) => set(on ? [...chosen, o] : chosen.filter((x) => x !== o))}
                    />
                  ))}
                </VStack>
              ) : (
                <RadioList label={q.question} value={chosen[0] ?? ''} onChange={(v) => set([v])}>
                  {[...q.options, OTHER].map((o) => (
                    <RadioListItem key={o} value={o} label={o === OTHER ? 'Outro (escrever)' : o} />
                  ))}
                </RadioList>
              )}
              {chosen.includes(OTHER) && (
                <TextInput
                  label={`Sua resposta (pergunta ${qi + 1})`}
                  value={other[q.question] ?? ''}
                  onChange={(v) => setOther((prev) => ({ ...prev, [q.question]: v }))}
                />
              )}
            </VStack>
          )
        })}
        <HStack gap={2}>
          <Button
            size="sm"
            variant="primary"
            label={questions.length > 1 ? 'Enviar respostas' : 'Responder'}
            isDisabled={!complete}
            {...(!complete ? { disabledMessage: 'Responda todas as perguntas.' } : {})}
            onClick={() =>
              onAnswer(Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])))
            }
          />
        </HStack>
      </VStack>
    </Card>
  )
}
