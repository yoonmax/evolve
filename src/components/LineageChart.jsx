// The record of an experiment: progress drawn as a curve, with each record-breaking
// champion standing on it at true scale, in the rest pose its genome decodes to.
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/applicationStore.js'
import { readTheme } from '../rendering/ArenaRenderer.js'
import { drawGenomeThumb } from '../rendering/CreatureRenderer.js'

export default function LineageChart({ history, version, selected, onSelect, height = 118 }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const geometryRef = useRef(null)
  const [hover, setHover] = useState(null)
  const themeTick = useApp((state) => state.themeTick)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return undefined
    const draw = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      geometryRef.current = drawLineage(ctx, history, rect.width, rect.height, dpr, selected)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(wrap)
    return () => observer.disconnect()
    // history mutates in place; version says when it changed
  }, [history, version, selected, themeTick, height])

  const generationAt = (clientX) => {
    const geometry = geometryRef.current
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!geometry || !rect || !history.length) return null
    const x = clientX - rect.left
    const index = Math.round((x - geometry.left) / geometry.stepX)
    return history[Math.max(0, Math.min(history.length - 1, index))]
  }

  if (!history.length) {
    return (
      <div className="lineage" ref={wrapRef} data-testid="lineage">
        <canvas ref={canvasRef} aria-hidden="true" />
        <div className="lineage-empty">Each generation&apos;s best creature will stand here, on the curve of how far it got.</div>
      </div>
    )
  }

  const last = history[history.length - 1]
  const current = selected ?? last.generation
  return (
    <div className="lineage" ref={wrapRef} data-testid="lineage">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Best distance by generation. Generation ${last.generation} reached ${last.bestDistance.toFixed(2)} metres.`}
        style={{ cursor: 'pointer' }}
        onPointerMove={(event) => {
          const record = generationAt(event.clientX)
          const rect = canvasRef.current.getBoundingClientRect()
          if (record) setHover({ record, x: event.clientX - rect.left })
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          const record = generationAt(event.clientX)
          if (record) onSelect(record.generation)
        }}
      />
      <input
        className="lineage-range"
        type="range"
        min={history[0].generation}
        max={last.generation}
        value={current}
        aria-label="Choose a generation to replay"
        onChange={(event) => onSelect(Number(event.target.value))}
      />
      {hover ? (
        <div className="chart-tip" style={{ left: Math.max(70, hover.x), top: 26 }}>
          generation {hover.record.generation}: {hover.record.bestDistance.toFixed(2)} m best, {hover.record.meanDistance.toFixed(2)} m mean
        </div>
      ) : null}
    </div>
  )
}

function drawLineage(ctx, history, width, height, dpr, selected) {
  const theme = readTheme()
  const left = 40
  const right = 20
  const top = Math.min(48, height * 0.4)
  const bottom = 16
  const plotHeight = height - top - bottom
  if (!history.length) return { left, stepX: 1 }
  const stepX = history.length > 1 ? (width - left - right) / (history.length - 1) : 0
  const values = history.map((record) => record.championDistance)
  const means = history.map((record) => record.meanDistance)
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...means)
  const xAt = (i) => left + i * stepX
  const yAt = (value) => top + plotHeight * (1 - (value - min) / (max - min))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // axis
  ctx.font = '11px "Hanken Grotesk Variable", system-ui, sans-serif'
  ctx.fillStyle = theme.inkSoft
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  ctx.fillText(`${max.toFixed(0)} m`, left - 8, yAt(max))
  ctx.fillText('0', left - 8, yAt(0))
  ctx.strokeStyle = theme.tick
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left, yAt(0))
  ctx.lineTo(width - right, yAt(0))
  ctx.stroke()

  // mean, then best
  ctx.beginPath()
  means.forEach((value, i) => (i ? ctx.lineTo(xAt(i), yAt(value)) : ctx.moveTo(xAt(i), yAt(value))))
  ctx.strokeStyle = theme.tick
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.beginPath()
  values.forEach((value, i) => (i ? ctx.lineTo(xAt(i), yAt(value)) : ctx.moveTo(xAt(i), yAt(value))))
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 1.75
  ctx.lineJoin = 'round'
  ctx.stroke()

  // record-breaking champions stand on the curve, spaced so that they stay legible
  const silhouetteScale = Math.min(24, top / 1.9)
  let lastX = -Infinity
  let recordSoFar = -Infinity
  const picks = []
  history.forEach((record, i) => {
    if (values[i] > recordSoFar + 1e-6) {
      recordSoFar = values[i]
      picks.push(i)
    }
  })
  const thinned = []
  for (let p = picks.length - 1; p >= 0; p--) {
    const x = xAt(picks[p])
    if (lastX - x >= 62 || lastX === -Infinity) {
      thinned.push(picks[p])
      lastX = x
    }
  }
  for (const i of thinned) {
    const record = history[i]
    const x = xAt(i)
    const y = yAt(values[i])
    ctx.save()
    drawGenomeThumb(ctx, record.bestGenome, { x: x - 40, y: y - 90, width: 80, height: 88, scale: silhouetteScale, anchor: 'bottom', dpr, paper: theme.paper, eye: true })
    ctx.restore()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const lastIndex = history.length - 1
  const marked = selected ? history.findIndex((record) => record.generation === selected) : lastIndex
  if (marked >= 0) {
    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.arc(xAt(marked), yAt(values[marked]), 3.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = theme.inkSoft
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`generation ${history[0].generation}`, left, height - 3)
  ctx.textAlign = 'right'
  if (lastIndex > 0) ctx.fillText(`${history[lastIndex].generation}`, width - right, height - 3)
  return { left, stepX: stepX || 1 }
}
