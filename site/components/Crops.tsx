import type { Dictionary } from '@/i18n/pt-BR'
import { ArrowIcon, CheckIcon, ClipIcon } from './Icons'
import { initials } from './initials'
import s from './crops.module.css'

/**
 * Recortes da interface do app ao lado de cada recurso, com a mesma moldura da janela do hero.
 * Decorativos (`aria-hidden`): o texto da seção já diz o mesmo. Dados de exemplo.
 */

function Frame({ crumb, children }: { crumb: string; children: React.ReactNode }) {
  return (
    <div className={s.crop} aria-hidden="true" data-glow="fill">
      <div className={s.bar}>
        <span className={s.traffic}>
          <i />
          <i />
          <i />
        </span>
        <span className={s.crumb}>{crumb}</span>
      </div>
      <div className={s.body}>{children}</div>
    </div>
  )
}

export function AgentsCrop({ t }: { t: Dictionary }) {
  const a = t.features.agents
  return (
    <Frame crumb={t.features.frames.agents}>
      <ol className={s.lanes}>
        {a.lanes.map((l, i) => (
          <li key={l.stage}>
            <div className={s.lane}>
              <span className={s.stage}>{l.stage}</span>
              <span className={s.agent}>
                <span className={s.avatar} data-i={i}>
                  {initials(l.agent)}
                </span>
                {l.agent}
              </span>
              <span className={s.tag} data-tone={l.tag === 'entrega' ? 'accent' : undefined}>
                {l.tag}
              </span>
            </div>
            {i < a.lanes.length - 1 && (
              <span className={s.next}>
                <ArrowIcon size={12} className={s.nextIcon} />
                {a.next}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Frame>
  )
}

export function FlowCrop({ t }: { t: Dictionary }) {
  const f = t.features.flow
  return (
    <Frame crumb={t.features.frames.flow}>
      <p className={s.flowName}>{f.name}</p>
      <ol className={s.steps}>
        {f.steps.map((step) => (
          <li key={step.name} className={s.step} data-state={step.state}>
            <span className={s.mark}>{step.state === 'done' && <CheckIcon size={11} />}</span>
            <span className={step.name.startsWith('/') ? s.code : undefined}>{step.name}</span>
            <span className={s.state}>{f.states[step.state as keyof typeof f.states]}</span>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

export function ReviewCrop({ t }: { t: Dictionary }) {
  const r = t.preview.review
  const first = r.comments[0]!
  return (
    <Frame crumb={t.features.frames.review}>
      <p className={s.reviewHead}>
        <span className={s.pill}>{r.pill}</span>
        {r.by}
      </p>
      <div className={s.thread}>
        <p className={s.file}>{first.where}</p>
        <pre className={s.diff}>
          {t.features.diff.map((line, i) => (
            <span key={i} className={s.diffLine} data-kind={line.kind}>
              <span className={s.lineNo}>{line.n}</span>
              <span className={s.sign}>
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
              </span>
              {line.code}
            </span>
          ))}
        </pre>
        <p className={s.comment}>
          <span className={s.bot}>orkio[bot]</span>
          {first.text}
        </p>
      </div>
      <p className={s.planLine}>
        <CheckIcon size={12} className={s.planIcon} />
        {r.plan[0]}
      </p>
    </Frame>
  )
}

export function ComposerCrop({ t }: { t: Dictionary }) {
  const c = t.features.composer
  return (
    <Frame crumb={t.features.frames.session}>
      <div className={s.picker}>
        <p className={s.pickerLabel}>{c.model}</p>
        <ul className={s.options}>
          {c.models.map((m, i) => (
            <li key={m} data-on={i === 1 || undefined}>
              {m}
              {i === 1 && <CheckIcon size={12} />}
            </li>
          ))}
        </ul>
        <p className={s.pickerLabel}>{c.effort}</p>
        <ul className={s.segments}>
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
          <span className={s.code}>{c.attachment}</span>
        </span>
        <span className={s.fieldText}>{t.preview.session.placeholder}</span>
      </div>
    </Frame>
  )
}
