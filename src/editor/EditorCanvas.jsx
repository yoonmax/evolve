// The drawing surface: selection, handles, grid, zoom and pan. Geometry comes straight
// from the genome's decoded rest pose, so what you shape is what the solver receives.
import { useEffect, useRef } from 'react'
import { anchorPoint, decodeGenome } from '../creatures/GenomeDecoder.js'
import { drawCreature, makeArt } from '../rendering/CreatureRenderer.js'
import { readTheme } from '../rendering/ArenaRenderer.js'
import { useApp } from '../state/applicationStore.js'
import { useEditor } from '../state/editorStore.js'
import { addSegment, pointInSegment } from './SegmentTool.js'
import { localToAnchor, moveAttachment, moveJoint, resizeFromPoint, rotateTo, worldToLocal } from './JointTool.js'

const HANDLE_R = 7

function handlesFor(genome, parts, index) {
  const part = parts[index]
  if (!part) return []
  const segment = part.segment
  const cos = Math.cos(part.angle)
  const sin = Math.sin(part.angle)
  const at = (lx, ly) => ({ x: part.x + lx * cos - ly * sin, y: part.y + lx * sin + ly * cos })
  const list = [
    { kind: 'resize-length', ...at(segment.w / 2, 0) },
    { kind: 'rotate', ...at(segment.w / 2 + 0.2, 0) },
  ]
  if (segment.shape !== 'circle') list.push({ kind: 'resize-height', ...at(0, segment.h / 2) })
  if (part.anchor) list.push({ kind: 'joint', x: part.anchor.x, y: part.anchor.y })
  return list
}

export default function EditorCanvas() {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const view = useRef({ x: 0, y: 0, zoom: 150, w: 1, h: 1, dpr: 1 })
  const fitted = useRef(false)
  const themeTick = useApp((state) => state.themeTick)
  const genome = useEditor((state) => state.genome)
  const selected = useEditor((state) => state.selected)
  const tool = useEditor((state) => state.tool)
  const grid = useEditor((state) => state.grid)
  const drawRef = useRef(() => {})

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { x, y, zoom, w, h, dpr } = view.current
      const ctx = canvas.getContext('2d')
      const theme = readTheme()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = theme.paper
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const sx = (wx) => (w / 2 + (wx - x) * zoom) * dpr
      const sy = (wy) => (h / 2 - (wy - y) * zoom) * dpr
      if (grid) drawGrid(ctx, view.current, theme, sx, sy)
      const phenotype = decodeGenome(genome, { centered: false })
      // Ground level: where the creature's lowest point will rest when it is placed.
      const groundY = sy(phenotype.bounds.minY)
      ctx.fillStyle = theme.ground
      ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY)
      ctx.strokeStyle = theme.groundLine
      ctx.lineWidth = 1.25 * dpr
      ctx.beginPath()
      ctx.moveTo(0, groundY)
      ctx.lineTo(canvas.width, groundY)
      ctx.stroke()
      const art = makeArt(genome)
      const k = zoom * dpr
      drawCreature(ctx, art, (i) => phenotype.parts[i], { k, ox: sx(0), oy: sy(0), dpr }, { paper: theme.paper, jointColor: theme.ink, outline: 'rgba(25,25,25,0.22)' })
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      const part = phenotype.parts[selected]
      if (part) {
        const cos = Math.cos(part.angle)
        const sin = Math.sin(part.angle)
        ctx.setTransform(k * cos, -k * sin, -k * sin, -k * cos, sx(part.x), sy(part.y))
        ctx.lineWidth = (2 * dpr) / k
        ctx.strokeStyle = theme.accent
        ctx.stroke(art.pieces[selected].path)
        if (part.segment.joint) {
          const pivot = anchorPoint(part.segment, part.segment.joint.anchorChild)
          // joint limit fan, drawn around the pivot
          ctx.beginPath()
          ctx.moveTo(pivot.x, pivot.y)
          ctx.arc(pivot.x, pivot.y, 0.28, part.segment.joint.lower, part.segment.joint.upper)
          ctx.closePath()
          ctx.fillStyle = `${theme.accent}26`
          ctx.fill()
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (const handle of handlesFor(genome, phenotype.parts, selected)) {
          const hx = sx(handle.x)
          const hy = sy(handle.y)
          ctx.beginPath()
          ctx.arc(hx, hy, (handle.kind === 'rotate' ? 6 : 5) * dpr, 0, Math.PI * 2)
          ctx.fillStyle = handle.kind === 'joint' ? theme.accent : theme.paper
          ctx.fill()
          ctx.lineWidth = 1.5 * dpr
          ctx.strokeStyle = theme.accent
          ctx.stroke()
          if (handle.kind === 'rotate') {
            ctx.beginPath()
            ctx.arc(hx, hy, 2.2 * dpr, 0, Math.PI * 2)
            ctx.fillStyle = theme.accent
            ctx.fill()
          }
        }
      }
    }
    drawRef.current()
  }, [genome, selected, grid, themeTick])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      view.current.w = rect.width
      view.current.h = rect.height
      view.current.dpr = dpr
      if (!fitted.current && rect.width > 1) {
        fitted.current = true
        fitView()
      }
      drawRef.current()
    }
    const fitView = () => {
      const phenotype = decodeGenome(useEditor.getState().genome, { centered: false })
      const { minX, maxX, minY, maxY } = phenotype.bounds
      view.current.x = (minX + maxX) / 2
      view.current.y = (minY + maxY) / 2
      view.current.zoom = Math.max(60, Math.min(240, Math.min(view.current.w / (maxX - minX + 1.2), view.current.h / (maxY - minY + 1.2))))
    }
    resize()
    if (new URLSearchParams(location.search).has('debug')) window.__evolve = { ...(window.__evolve ?? {}), editorView: view.current }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    const off = useEditor.subscribe((state, previous) => {
      if (state.past.length === 0 && previous.past.length !== 0) {
        fitView()
        drawRef.current()
      }
      if (state.genome !== previous.genome && state.past.length === 0) {
        fitView()
        drawRef.current()
      }
    })
    return () => {
      observer.disconnect()
      off()
    }
  }, [])

  // pointer interactions
  useEffect(() => {
    const canvas = canvasRef.current
    let drag = null
    const toWorld = (event) => {
      const rect = canvas.getBoundingClientRect()
      const { x, y, zoom, w, h } = view.current
      return { px: event.clientX - rect.left, py: event.clientY - rect.top, wx: (event.clientX - rect.left - w / 2) / zoom + x, wy: y - (event.clientY - rect.top - h / 2) / zoom }
    }
    const findSegment = (parts, wx, wy) => {
      for (let i = 0; i < parts.length; i++) {
        const local = worldToLocal(parts[i], wx, wy)
        if (pointInSegment(parts[i].segment, local.x, local.y, 0.015)) return i
      }
      return -1
    }
    const down = (event) => {
      const state = useEditor.getState()
      const { wx, wy, px, py } = toWorld(event)
      canvas.setPointerCapture?.(event.pointerId)
      const phenotype = decodeGenome(state.genome, { centered: false })
      const parts = phenotype.parts
      const { zoom } = view.current
      if (state.tool === 'add') {
        const target = findSegment(parts, wx, wy)
        if (target >= 0) {
          const local = worldToLocal(parts[target], wx, wy)
          const anchor = localToAnchor(parts[target].segment, local)
          const outward = Math.atan2(wy - parts[target].y, wx - parts[target].x) - parts[target].angle
          let index = -1
          state.update((draft) => {
            index = addSegment(draft, target, { u: anchor.u, v: anchor.v, rest: anchor.v === 0 && anchor.u === 0 ? -1.2 : Math.max(-3, Math.min(3, outward)) })
          })
          if (index >= 0) state.select(index)
          state.setTool('select')
        }
        return
      }
      for (const handle of handlesFor(state.genome, parts, state.selected)) {
        const distance = Math.hypot((handle.x - wx) * zoom, (handle.y - wy) * zoom)
        if (distance <= HANDLE_R + 4) {
          drag = { kind: handle.kind, index: state.selected, key: `${handle.kind}-${Date.now()}` }
          return
        }
      }
      const hit = findSegment(parts, wx, wy)
      if (hit >= 0) {
        state.select(hit)
        if (hit > 0) {
          const anchor = parts[hit].anchor
          drag = { kind: 'move', index: hit, key: `move-${Date.now()}`, offsetX: anchor.x - wx, offsetY: anchor.y - wy }
        } else {
          drag = { kind: 'pan', lastX: px, lastY: py }
        }
        return
      }
      state.select(null)
      drag = { kind: 'pan', lastX: px, lastY: py }
    }
    const move = (event) => {
      if (!drag) return
      const { wx, wy, px, py } = toWorld(event)
      if (drag.kind === 'pan') {
        view.current.x -= (px - drag.lastX) / view.current.zoom
        view.current.y += (py - drag.lastY) / view.current.zoom
        drag.lastX = px
        drag.lastY = py
        drawRef.current()
        return
      }
      const state = useEditor.getState()
      const snap = state.snap !== event.altKey
      const { index } = drag
      state.update((draft) => {
        const parts = decodeGenome(draft, { centered: false }).parts
        const segment = draft.segments[index]
        if (drag.kind === 'move') moveAttachment(draft, parts, index, wx + drag.offsetX, wy + drag.offsetY, snap)
        else if (drag.kind === 'joint') moveJoint(draft, parts, index, wx, wy, snap)
        else if (drag.kind === 'rotate') rotateTo(draft, parts, index, wx, wy, snap)
        else if (drag.kind === 'resize-length') resizeFromPoint(segment, worldToLocal(parts[index], wx, wy), 'length', snap)
        else if (drag.kind === 'resize-height') resizeFromPoint(segment, worldToLocal(parts[index], wx, wy), 'height', snap)
      }, { key: drag.key })
    }
    const up = () => {
      drag = null
    }
    const wheel = (event) => {
      event.preventDefault()
      const { wx, wy, px, py } = toWorld(event)
      const v = view.current
      v.zoom = Math.max(40, Math.min(520, v.zoom * Math.exp(-event.deltaY * 0.0015)))
      v.x = wx - (px - v.w / 2) / v.zoom
      v.y = wy + (py - v.h / 2) / v.zoom
      drawRef.current()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [])

  const description = `Editing ${genome.name}: ${genome.segments.length} segments. Use the segment list and the sliders for full control without dragging.`
  return (
    <div className="editor-canvas" ref={wrapRef} style={{ cursor: tool === 'add' ? 'copy' : 'default' }}>
      <canvas ref={canvasRef} role="img" aria-label={description} data-testid="editor-canvas" />
    </div>
  )
}

function drawGrid(ctx, v, theme, sx, sy) {
  const { x, y, zoom, w, h, dpr } = v
  const left = x - w / 2 / zoom
  const right = x + w / 2 / zoom
  const bottom = y - h / 2 / zoom
  const top = y + h / 2 / zoom
  const minor = zoom > 90 ? 0.1 : 0.5
  ctx.lineWidth = 1
  for (let gx = Math.floor(left / minor) * minor; gx <= right; gx += minor) {
    const major = Math.abs(gx / 0.5 - Math.round(gx / 0.5)) < 1e-6
    ctx.strokeStyle = theme.tick
    ctx.globalAlpha = major ? 0.55 : 0.2
    ctx.beginPath()
    ctx.moveTo(Math.round(sx(gx)), 0)
    ctx.lineTo(Math.round(sx(gx)), h * dpr)
    ctx.stroke()
  }
  for (let gy = Math.floor(bottom / minor) * minor; gy <= top; gy += minor) {
    const major = Math.abs(gy / 0.5 - Math.round(gy / 0.5)) < 1e-6
    ctx.strokeStyle = theme.tick
    ctx.globalAlpha = major ? 0.55 : 0.2
    ctx.beginPath()
    ctx.moveTo(0, Math.round(sy(gy)))
    ctx.lineTo(w * dpr, Math.round(sy(gy)))
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
