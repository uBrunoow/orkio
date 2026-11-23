import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField, RadioListField, TextField } from '@/components/form'
import { QuestionIcon } from '../../components/icons'

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
    <div
      role="group"
      aria-label="Pergunta do Claude Code"
      className="flex flex-col gap-3.5 rounded-[10px] border border-warn-tint-border bg-warn-tint p-3.5"
    >
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <QuestionIcon className="size-4 text-warn" />
        Pergunta do Claude Code
        {questions.length > 1 ? ` · ${questions.length} perguntas — responda todas e envie.` : ''}
      </p>
      {questions.map((q, qi) => {
        const chosen = picked[q.question] ?? []
        const set = (values: string[]): void =>
          setPicked((prev) => ({ ...prev, [q.question]: values }))
        return (
          <div
            key={q.question}
            role="group"
            aria-label={`Pergunta ${qi + 1}: ${q.question}`}
            className="flex flex-col gap-2"
          >
            {q.multiSelect ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{q.question}</p>
                {[...q.options, OTHER].map((o) => (
                  <CheckboxField
                    key={o}
                    label={o === OTHER ? 'Outro (escrever)' : o}
                    checked={chosen.includes(o)}
                    onChange={(on) => set(on ? [...chosen, o] : chosen.filter((x) => x !== o))}
                  />
                ))}
              </div>
            ) : (
              <RadioListField
                label={q.question}
                value={chosen[0] ?? ''}
                onChange={(v) => set([v])}
                options={[...q.options, OTHER].map((o) => ({
                  value: o,
                  label: o === OTHER ? 'Outro (escrever)' : o
                }))}
              />
            )}
            {chosen.includes(OTHER) && (
              <TextField
                label={`Sua resposta (pergunta ${qi + 1})`}
                value={other[q.question] ?? ''}
                onChange={(v) => setOther((prev) => ({ ...prev, [q.question]: v }))}
              />
            )}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!complete}
          onClick={() =>
            onAnswer(Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])))
          }
        >
          {questions.length > 1 ? 'Enviar respostas' : 'Responder'}
        </Button>
        {!complete && (
          <span className="text-xs text-muted-foreground">Responda todas as perguntas.</span>
        )}
      </div>
    </div>
  )
}
