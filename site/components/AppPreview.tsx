'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dictionary } from '@/i18n/pt-BR'

type Preview = Dictionary['preview']
import { BranchIcon, CheckIcon, ClipIcon, PauseIcon, PlayIcon, TerminalIcon } from './Icons'
import { initials } from './initials'
import { Symbol } from './Logo'
import s from './preview.module.css'

type Scene = 'quadro' | 'sessao' | 'push' | 'revisao'
const ORDER: Scene[] = ['quadro', 'sessao', 'push', 'revisao']

/** Quanto cada momento fica na tela (ms). Push e revisão esperam o clique um pouco mais. */
const DURATION: Record<Scene, number> = { quadro: 5200, sessao: 7600, push: 7000, revisao: 8000 }
/** Fase de agora na barra de fases (índice em `phases`). */
const PHASE: Record<Scene, number> = { quadro: 2, sessao: 2, push: 4, revisao: 3 }

export function AppPreview({ p }: { p: Preview }) {
  const [scene, setScene] = useState<Scene>('quadro')
  const [paused, setPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const [visible, setVisible] = useState(true)
  const [reduced, setReduced] = useState(false)
  const [pushed, setPushed] = useState(false)
  const [approved, setApproved] = useState(false)
  const [moved, setMoved] = useState(false)
  // Muda a cada troca de momento: reinicia as animações de entrada e a barra de progresso.
  const [round, setRound] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  const go = useCallback((next: Scene) => {
    setScene(next)
    setPushed(false)
    setApproved(false)
    setMoved(next !== 'quadro')
    setRound((r) => r + 1)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      threshold: 0.35
    })
    if (root.current) io.observe(root.current)
    return () => {
      mq.removeEventListener('change', sync)
      io.disconnect()
    }
  }, [])

  useEffect(() => {
    if (scene !== 'quadro' || reduced) return
    const id = window.setTimeout(() => setMoved(true), 1300)
    return () => window.clearTimeout(id)
  }, [scene, round, reduced])
  const boardMoved = moved || reduced

  const running = !paused && !held && visible && !reduced

  useEffect(() => {
    if (!running) return
    const wait =
      (scene === 'push' && pushed) || (scene === 'revisao' && approved) ? 2200 : DURATION[scene]
    const id = window.setTimeout(() => {
      if (scene === 'push' && !pushed) {
        setPushed(true)
        return
      }
      if (scene === 'revisao' && !approved) {
        setApproved(true)
        return
      }
      go(ORDER[(ORDER.indexOf(scene) + 1) % ORDER.length]!)
    }, wait)
    return () => window.clearTimeout(id)
  }, [running, scene, pushed, approved, round, go])

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const n = (i + delta + ORDER.length) % ORDER.length
    go(ORDER[n]!)
    tabs.current[n]?.focus()
  }

  const phase = PHASE[scene]
  const waiting = (scene === 'push' && !pushed) || (scene === 'revisao' && !approved)
  const current = p.scenes.find((x) => x.id === scene)!

  return (
    <div
      ref={root}
      className={s.wrap}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false)
      }}
    >
      <figure className={s.figure} aria-label={p.label} aria-describedby="preview-desc">
        <p id="preview-desc" className="visually-hidden">
          {p.description}
        </p>
        <div
          className={s.window}
          data-glow
          role="tabpanel"
          id="preview-panel"
          aria-labelledby={`preview-tab-${scene}`}
          data-scene={scene}
        >
          <div className={s.titlebar} aria-hidden="true">
            <span className={s.traffic}>
              <i />
              <i />
              <i />
            </span>
            <span className={s.appName}>
              <Symbol size={14} className={s.sideSymbol} />
              Orkio
            </span>
          </div>
          <div className={s.chrome}>
            <span className={s.path}>
              <span>{p.project}</span>
              <span className={s.pathSep} aria-hidden="true">
                /
              </span>
              <span className={s.mono}>{p.taskId}</span>
            </span>
            <ol className={s.phases} aria-label="Fases da tarefa">
              {p.phases.map((name, i) => (
                <li
                  key={name}
                  className={s.phase}
                  data-state={
                    i < phase ? 'done' : i === phase ? (waiting ? 'wait' : 'now') : 'next'
                  }
                >
                  {i < phase ? <CheckIcon size={12} /> : <span className={s.phaseDot} />}
                  <span className={s.phaseName}>{name}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className={s.body}>
            <aside className={s.side} aria-hidden="true">
              <SideGroup
                title={p.side.waiting}
                items={waiting ? [{ id: p.taskId, title: p.task, hot: true }] : []}
              />
              <SideGroup
                title={p.side.running}
                items={
                  scene === 'sessao' || (scene === 'quadro' && boardMoved)
                    ? [{ id: p.taskId, title: p.task, live: true }]
                    : []
                }
              />
              <SideGroup
                title={p.side.todo}
                items={p.board.others
                  .filter((o) => o.col === 0)
                  .map((o) => ({ id: o.id, title: o.title }))}
              />
              <ul className={s.sideNav}>
                <li data-on={scene === 'quadro' || undefined}>{p.side.board}</li>
                <li>{p.side.agents}</li>
                <li>{p.side.settings}</li>
              </ul>
            </aside>

            <div className={s.stage} key={`${scene}-${round}`}>
              {scene === 'quadro' && <BoardScene p={p} moved={boardMoved} />}
              {scene === 'sessao' && <SessionScene p={p} />}
              {scene === 'push' && (
                <div className={s.modalScene}>
                  <div className={s.behind} aria-hidden="true">
                    <SessionScene p={p} still />
                  </div>
                  <PushScene p={p} pushed={pushed} onPush={() => setPushed(true)} />
                </div>
              )}
              {scene === 'revisao' && (
                <ReviewScene p={p} approved={approved} onApprove={() => setApproved(true)} />
              )}
            </div>
          </div>
        </div>

        <figcaption className={s.caption}>
          <p className={s.sceneTitle} aria-live="polite">
            {current.title}
          </p>
          <div className={s.controls}>
            <div role="tablist" aria-label={p.scenesLabel} className={s.tabs}>
              {p.scenes.map((sc, i) => {
                const on = sc.id === scene
                return (
                  <button
                    key={sc.id}
                    ref={(el) => {
                      tabs.current[i] = el
                    }}
                    type="button"
                    role="tab"
                    id={`preview-tab-${sc.id}`}
                    aria-selected={on}
                    aria-controls="preview-panel"
                    tabIndex={on ? 0 : -1}
                    className={s.tab}
                    onClick={() => go(sc.id as Scene)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    {sc.tab}
                    {on && (
                      <span
                        key={round}
                        className={s.progress}
                        data-running={running || undefined}
                        style={{ animationDuration: `${DURATION[scene]}ms` }}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                )
              })}
            </div>
            {!reduced && (
              <button
                type="button"
                className={s.pause}
                onClick={() => setPaused((v) => !v)}
                aria-label={paused ? p.play : p.pause}
              >
                {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
              </button>
            )}
          </div>
          <p className={s.sample}>{p.sample}</p>
        </figcaption>
      </figure>
    </div>
  )
}

function SideGroup({
  title,
  items
}: {
  title: string
  items: { id: string; title: string; hot?: boolean; live?: boolean }[]
}) {
  if (items.length === 0) return null
  return (
    <div className={s.sideGroup}>
      <p className={s.sideTitle}>
        {title}
        <span className={s.sideCount}>{items.length}</span>
      </p>
      <ul>
        {items.map((i) => (
          <li key={i.id} className={s.sideItem} data-hot={i.hot || undefined}>
            <span
              className={s.sideDot}
              data-tone={i.hot ? 'accent' : i.live ? 'live' : undefined}
            />
            <span className={s.mono}>{i.id}</span>
            <span className={s.sideText}>{i.title}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BoardScene({ p, moved }: { p: Preview; moved: boolean }) {
  const b = p.board
  return (
    <div className={s.board}>
      {b.columns.map((col, ci) => {
        const others = b.others.filter((o) => o.col === ci)
        const mine = (ci === 0 && !moved) || (ci === 1 && moved)
        return (
          <section key={col} className={s.column} aria-hidden="true">
            <p className={s.columnHead}>
              {col}
              <span className={s.sideCount}>{others.length + (mine ? 1 : 0)}</span>
            </p>
            {mine && (
              <div className={s.card} data-main data-moved={(ci === 1 && moved) || undefined}>
                <span className={s.mono}>{p.taskId}</span>
                <p className={s.cardTitle}>{p.task}</p>
                {ci === 1 ? (
                  <p className={s.cardAgent}>
                    <span className={s.avatar}>{initials(b.agent)}</span>
                    {b.agent}
                    <span className={s.live}>{b.running}</span>
                  </p>
                ) : (
                  <p className={s.cardMeta}>
                    <BranchIcon size={12} />
                    <span className={s.mono}>sem branch</span>
                  </p>
                )}
              </div>
            )}
            {others.map((o) => (
              <div key={o.id} className={s.card}>
                <span className={s.mono}>{o.id}</span>
                <p className={s.cardTitle}>{o.title}</p>
                {ci === 2 && (
                  <p className={s.cardMeta}>
                    <span className={s.chip} data-tone="warn">
                      PR #54 · revisão pedida
                    </span>
                  </p>
                )}
                {ci === 3 && (
                  <p className={s.cardMeta}>
                    <span className={s.chip} data-tone="ok">
                      PR #49 · mergeada
                    </span>
                  </p>
                )}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function SessionScene({ p, still = false }: { p: Preview; still?: boolean }) {
  const x = p.session
  return (
    <div className={s.session}>
      <p className={s.autopilot}>{x.autopilot}</p>
      <p className={s.command}>
        <TerminalIcon size={13} />
        <span className={s.mono}>{x.command}</span>
      </p>
      <ol className={s.lines}>
        {x.lines.map((l, i) => (
          <li
            key={i}
            className={s.line}
            data-kind={l.kind}
            style={still ? { animation: 'none' } : { animationDelay: `${400 + i * 1050}ms` }}
          >
            {l.kind === 'text' ? (
              <p>{l.text}</p>
            ) : (
              <p>
                <span className={s.lineHead}>
                  {l.kind === 'tool' ? <CheckIcon size={12} /> : <span className={s.subDot} />}
                  {l.text}
                </span>
                {'detail' in l && <span className={s.lineDetail}>{l.detail}</span>}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className={s.composer}>
        <span className={s.placeholder}>{x.placeholder}</span>
        <span className={s.composerBar}>
          <span className={s.pill}>
            {x.model} · {x.effort}
          </span>
          <ClipIcon size={13} />
          <span className={s.composerMeta}>{x.context}</span>
          <span className={s.composerMeta}>{x.cost}</span>
        </span>
      </div>
    </div>
  )
}

function PushScene({ p, pushed, onPush }: { p: Preview; pushed: boolean; onPush: () => void }) {
  const g = p.push
  return (
    <div className={s.gateWrap}>
      <div className={s.gate} data-done={pushed || undefined}>
        <p className={s.gateTitle}>{g.title}</p>
        <dl className={s.gateRows}>
          <div>
            <dt>{g.destination}</dt>
            <dd className={s.mono}>origin/{p.branch}</dd>
          </div>
          <div>
            <dt>{g.commits}</dt>
            <dd>
              <ul className={s.commitList}>
                {g.commitList.map((c) => (
                  <li key={c} className={s.mono}>
                    {c}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>{g.changes}</dt>
            <dd className={s.mono}>{g.stat}</dd>
          </div>
        </dl>
        {pushed ? (
          <p className={s.gateDone} role="status">
            <CheckIcon size={14} />
            {g.done}
          </p>
        ) : (
          <div className={s.gateActions}>
            <button type="button" className={s.btnPrimary} onClick={onPush}>
              {g.approve}
            </button>
            <button type="button" className={s.btnGhost} tabIndex={-1} aria-disabled="true">
              {g.reject}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewScene({
  p,
  approved,
  onApprove
}: {
  p: Preview
  approved: boolean
  onApprove: () => void
}) {
  const r = p.review
  return (
    <div className={s.review}>
      <div className={s.reviewCard}>
        <p className={s.reviewHead}>
          <span className={s.chip} data-tone="warn">
            {r.pill}
          </span>
          <span>{r.by}</span>
        </p>
        <ul className={s.threads}>
          {r.comments.map((c) => (
            <li key={c.where}>
              <span className={s.mono}>{c.where}</span>
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className={s.gate} data-done={approved || undefined}>
        <p className={s.gateTitle}>{r.planTitle}</p>
        <ol className={s.plan}>
          {r.plan.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {approved ? (
          <p className={s.gateDone} role="status">
            <CheckIcon size={14} />
            {r.approved}
          </p>
        ) : (
          <div className={s.gateActions}>
            <button type="button" className={s.btnPrimary} onClick={onApprove}>
              {r.approve}
            </button>
            <button type="button" className={s.btnGhost} tabIndex={-1} aria-disabled="true">
              {r.revise}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
