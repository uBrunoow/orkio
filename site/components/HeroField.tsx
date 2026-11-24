'use client'

import { useEffect, useRef } from 'react'
import s from './field.module.css'

/**
 * Fundo do hero: a grade técnica da marca com sinais laranja correndo pelas linhas, como tarefas
 * sendo roteadas; onde um sinal para, o cruzamento acende. A grade é fundo de CSS (desenhada uma
 * vez, ver field.module.css, mesma célula de 56 px); o canvas só desenha os sinais. Decorativo.
 * Para fora da tela e com a aba escondida; com movimento reduzido, só a grade parada.
 */

const CELL = 56
const MAX_SIGNALS = 6
const SPEED = 110 // px/s
const TRAIL = 2.6 // em células

interface Signal {
  x: number
  y: number
  dx: number
  dy: number
  left: number // células até a próxima decisão
  life: number // células restantes
  trail: { x: number; y: number }[]
}

interface Spark {
  x: number
  y: number
  t: number
}

function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function HeroField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const accent = cssColor('--accent', '#ff5b1f')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    let cols = 0
    let rows = 0
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(w / CELL)
      rows = Math.ceil(h / CELL)
      if (reduced || !running) draw(0)
    }

    const signals: Signal[] = []
    const sparks: Spark[] = []
    const spawn = () => {
      const x = Math.floor(Math.random() * cols) * CELL
      const y = Math.floor(Math.random() * Math.max(rows - 1, 1)) * CELL
      signals.push({
        x,
        y,
        // Sempre na horizontal, da esquerda para a direita: nada "cai" pela tela.
        dx: 1,
        dy: 0,
        left: 2 + Math.floor(Math.random() * 4),
        life: 6 + Math.floor(Math.random() * 8),
        trail: []
      })
    }

    let last = 0
    let nextSpawn = 0
    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h)
      if (reduced) return
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0
      last = now
      if (now > nextSpawn && signals.length < MAX_SIGNALS) {
        spawn()
        nextSpawn = now + 700 + Math.random() * 1400
      }
      const step = SPEED * dt
      for (let i = signals.length - 1; i >= 0; i--) {
        const sg = signals[i]!
        const before = { x: sg.x, y: sg.y }
        sg.x += sg.dx * step
        sg.y += sg.dy * step
        sg.trail.push(before)
        if (sg.trail.length > 40) sg.trail.shift()
        // Chegou a um cruzamento: conta a célula e decide se vira.
        const crossed =
          Math.floor(before.x / CELL) !== Math.floor(sg.x / CELL) ||
          Math.floor(before.y / CELL) !== Math.floor(sg.y / CELL)
        if (crossed) {
          sg.x = Math.round(sg.x / CELL) * CELL
          sg.y = Math.round(sg.y / CELL) * CELL
          sg.left--
          sg.life--
          if (sg.left <= 0) {
            if (sg.dy) {
              // Desvio vertical dura uma célula só e volta para a horizontal.
              sg.dx = 1
              sg.dy = 0
              sg.left = 2 + Math.floor(Math.random() * 4)
            } else if (Math.random() < 0.5) {
              sg.dx = 0
              sg.dy = Math.random() < 0.5 ? 1 : -1
              sg.left = 1
            } else {
              sg.left = 2 + Math.floor(Math.random() * 4)
            }
          }
          if (sg.life <= 0 || sg.x > w + CELL || sg.y < -CELL || sg.y > h + CELL) {
            sparks.push({ x: sg.x, y: sg.y, t: 1 })
            signals.splice(i, 1)
            continue
          }
        }
        // Rastro: do mais velho (apagado) à cabeça (laranja).
        const pts = [...sg.trail, { x: sg.x, y: sg.y }]
        const maxLen = TRAIL * CELL
        let len = 0
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.5
        for (let k = pts.length - 1; k > 0 && len < maxLen; k--) {
          const a = pts[k]!
          const b = pts[k - 1]!
          const seg = Math.hypot(a.x - b.x, a.y - b.y)
          len += seg
          ctx.strokeStyle = rgba(accent, 0.75 * (1 - len / maxLen))
          ctx.beginPath()
          ctx.moveTo(a.x + 0.5, a.y + 0.5)
          ctx.lineTo(b.x + 0.5, b.y + 0.5)
          ctx.stroke()
        }
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(sg.x + 0.5, sg.y + 0.5, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
      // Cruzamento aceso onde o sinal parou.
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i]!
        sp.t -= dt * 0.9
        if (sp.t <= 0) {
          sparks.splice(i, 1)
          continue
        }
        ctx.fillStyle = rgba(accent, 0.9 * sp.t)
        ctx.fillRect(sp.x - 2, sp.y - 2, 5, 5)
        ctx.strokeStyle = rgba(accent, 0.35 * sp.t)
        ctx.lineWidth = 1
        ctx.strokeRect(sp.x - 6.5, sp.y - 6.5, 14, 14)
      }
    }

    let raf = 0
    let running = false
    const loop = (now: number) => {
      draw(now)
      raf = requestAnimationFrame(loop)
    }
    const start = () => {
      if (running || reduced) return
      running = true
      last = 0
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    let inView = true
    const io = new IntersectionObserver(([e]) => {
      inView = !!e?.isIntersecting
      if (inView && !document.hidden) start()
      else stop()
    })
    io.observe(canvas)
    const onVis = () => (document.hidden || !inView ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    start()
    return () => {
      stop()
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={ref} className={s.field} aria-hidden="true" />
}
