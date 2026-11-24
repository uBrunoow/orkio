'use client'

import { useEffect } from 'react'

/**
 * Movimento que responde ao cursor, num só ouvinte para a página toda:
 * - parallax leve do hero: cada `[data-depth="N"]` anda até N px com o cursor (negativo = ao
 *   contrário). Interpolado em JS e escrito como `translate` só nessas camadas (sem variável CSS
 *   no hero, que recalcularia o estilo da seção inteira a cada movimento); o laço para quando
 *   as camadas chegam ao alvo.
 * - brilho que acompanha o cursor nas molduras (`[data-glow]` ganha `--gx`/`--gy` em px).
 * Só com mouse (pointer fine) e sem movimento reduzido; no toque nada disso liga.
 */
export function Ambient() {
  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!fine.matches || reduced.matches) return

    const layers = Array.from(document.querySelectorAll<HTMLElement>('[data-depth]')).map((el) => ({
      el,
      depth: Number(el.dataset.depth) || 0
    }))
    const hero = layers[0]?.el.closest('section') ?? null
    let heroVisible = true
    const io = hero
      ? new IntersectionObserver(([e]) => {
          heroVisible = !!e?.isIntersecting
        })
      : null
    if (hero) io?.observe(hero)

    // Alvo (-1..1) e posição atual, que persegue o alvo com amortecimento.
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let parallaxRaf = 0
    const step = () => {
      cx += (tx - cx) * 0.08
      cy += (ty - cy) * 0.08
      const done = Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001
      if (done) {
        cx = tx
        cy = ty
      }
      for (const { el, depth } of layers) {
        el.style.translate = `${(cx * depth).toFixed(2)}px ${(cy * depth * 0.6).toFixed(2)}px`
      }
      parallaxRaf = done ? 0 : requestAnimationFrame(step)
    }

    let glowRaf = 0
    let last: PointerEvent | null = null
    const glow = () => {
      glowRaf = 0
      const e = last
      if (!e || !(e.target instanceof Element)) return
      const target = e.target.closest<HTMLElement>('[data-glow]')
      if (!target) return
      const r = target.getBoundingClientRect()
      target.style.setProperty('--gx', `${Math.round(e.clientX - r.left)}px`)
      target.style.setProperty('--gy', `${Math.round(e.clientY - r.top)}px`)
    }

    const onMove = (e: PointerEvent) => {
      last = e
      if (!glowRaf) glowRaf = requestAnimationFrame(glow)
      if (layers.length && heroVisible) {
        tx = (e.clientX / window.innerWidth) * 2 - 1
        ty = (e.clientY / window.innerHeight) * 2 - 1
        if (!parallaxRaf) parallaxRaf = requestAnimationFrame(step)
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(glowRaf)
      cancelAnimationFrame(parallaxRaf)
      io?.disconnect()
      for (const { el } of layers) el.style.translate = ''
    }
  }, [])

  return null
}
