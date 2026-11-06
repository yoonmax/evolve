// A creature's portrait, drawn from its genome's actual geometry.
import { useEffect, useRef } from 'react'
import { drawGenomeThumb } from '../rendering/CreatureRenderer.js'
import { useApp } from '../state/applicationStore.js'
import { readTheme } from '../rendering/ArenaRenderer.js'

export default function Thumb({ genome, className, label }) {
  const ref = useRef(null)
  const themeTick = useApp((state) => state.themeTick)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(Math.max(1, rect.width) * dpr)
    canvas.height = Math.round(Math.max(1, rect.height) * dpr)
    const ctx = canvas.getContext('2d')
    drawGenomeThumb(ctx, genome, { x: 0, y: 0, width: rect.width, height: rect.height, dpr, paper: readTheme().paper })
  }, [genome, themeTick])
  return <canvas ref={ref} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
