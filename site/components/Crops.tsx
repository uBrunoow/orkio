import type { Dictionary } from '@/i18n/pt-BR'
import { ArrowIcon, CheckIcon, ClipIcon } from './Icons'
import s from './crops.module.css'

/**
 * Recortes da interface do app ao lado de cada recurso. Decorativos (`aria-hidden`): o texto da
 * seção já diz o mesmo. Dados de exemplo.
 */

export function AgentsCrop({ t }: { t: Dictionary }) {
  const a = t.features.agents
  return (
    <div className={s.crop} aria-hidden="true">
      <ol className={s.lanes}>
        {a.lanes.map((l, i) => (
          <li key={l.stage} className={s.lane}>
            <span className={s.stage}>{l.stage}</span>
            <span className={s.agent}>
              <span className={s.avatar} data-i={i}>
                {l.agent
                  .split(' ')
                  .filter((w) => w.length > 2)
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              {l.agent}
            </span>
            <span className={s.tag} data-tone={l.tag === 'entrega' ? 'accent' : undefined}>
              {l.tag}
            </span>
            {i < a.lanes.length - 1 && (
              <span className={s.next}>
                <ArrowIcon size={12} />
                {a.next}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function FlowCrop({ t }: { t: Dictionary }) {
  const f = t.features.flow
  return (
    <div className={s.crop} aria-hidden="true">
      <p className={s.cropTitle}>{f.name}</p>
      <ol className={s.steps}>
        {f.steps.map((step) => (
          <li key={step.name} className={s.step} data-state={step.state}>
            <span className={s.mark}>{step.state === 'done' && <CheckIcon size={11} />}</span>
            <span className={step.name.startsWith('/') ? s.mono : undefined}>{step.name}</span>
            <span className={s.state}>{f.states[step.state as keyof typeof f.states]}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ReviewCrop({ t }: { t: Dictionary }) {
  const r = t.preview.review
  return (
    <div className={s.crop} aria-hidden="true">
      <p className={s.cropTitle}>
        <span className={s.pill}>{r.pill}</span>
        {r.by}
      </p>
      <ul className={s.threads}>
        {r.comments.map((c) => (
          <li key={c.where}>
            <span className={s.mono}>{c.where}</span>
            <p>{c.text}</p>
          </li>
        ))}
      </ul>
      <div className={s.actions}>
        <span className={s.btn}>{r.approve}</span>
        <span className={s.btnGhost}>{r.revise}</span>
      </div>
    </div>
  )
}

export function ComposerCrop({ t }: { t: Dictionary }) {
  const c = t.features.composer
  return (
    <div className={s.crop} aria-hidden="true">
      <div className={s.picker}>
        <p className={s.pickerLabel}>{c.model}</p>
        <ul className={s.options}>
          {c.models.map((m, i) => (
            <li key={m} data-on={i === 1 || undefined}>
              {m}
            </li>
          ))}
        </ul>
        <p className={s.pickerLabel}>{c.effort}</p>
        <ul className={s.grid}>
          {c.efforts.map((e, i) => (
            <li key={e} data-on={i === 2 || undefined}>
              {e}
            </li>
          ))}
        </ul>
      </div>
      <div className={s.field}>
        <span className={s.attachment}>
          <ClipIcon size={12} />
          <span className={s.mono}>{c.attachment}</span>
        </span>
        <span className={s.fieldText}>{t.preview.session.placeholder}</span>
      </div>
    </div>
  )
}
