// Mounts an ArenaRenderer and drives it with requestAnimationFrame. Drawing happens here;
// physics does not. Time on the clock only selects which recorded state to show.
import { useEffect, useRef } from 'react'
import { ArenaRenderer, readTheme } from '../rendering/ArenaRenderer.js'
import { useApp } from '../state/applicationStore.js'

export default function Arena({ scene, clock, follow = 'leader', debug = null, trails = true, onPick, onFrame, label, children, primary = false, onUserCamera }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const latest = useRef({})
  const themeTick = useApp((state) => state.themeTick)
  latest.current = { clock, onFrame, onPick, onUserCamera }

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = new ArenaRenderer(canvas)
    rendererRef.current = renderer
    const container = containerRef.current
    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height), dpr)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    let raf = 0
    let last = performance.now()
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const { clock: currentClock, onFrame: frameCallback } = latest.current
      if (primary) currentClock.advance(dt)
      renderer.render(currentClock.time, dt)
      frameCallback?.(currentClock.time, renderer)
    }
    raf = requestAnimationFrame(tick)
    if (primary) clock.attached = (clock.attached ?? 0) + 1
    if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
      window.__evolve = { ...(window.__evolve ?? {}), renderer }
    }
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      if (primary) clock.attached -= 1
    }
    // The renderer lives as long as the canvas; props reach it through refs and effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rendererRef.current?.setScene(scene)
  }, [scene])

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.options = { ...rendererRef.current.options, follow, debug, trails }
  }, [follow, debug, trails])

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.theme = readTheme()
  }, [themeTick])

  // Direct manipulation: drag to pan, wheel or pinch to zoom, tap to pick a creature.
  useEffect(() => {
    const canvas = canvasRef.current
    const pointers = new Map()
    let moved = 0
    let pinchDistance = 0
    const position = (event) => {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const down = (event) => {
      pointers.set(event.pointerId, position(event))
      moved = 0
      canvas.setPointerCapture?.(event.pointerId)
    }
    const move = (event) => {
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const point = position(event)
      const renderer = rendererRef.current
      if (pointers.size === 1) {
        const dx = point.x - previous.x
        const dy = point.y - previous.y
        moved += Math.abs(dx) + Math.abs(dy)
        if (moved > 4 && renderer.options.follow !== 'locked' && renderer.scene?.layout !== 'grid' && renderer.scene?.layout !== 'lanes') {
          renderer.camera.panBy(dx, dy)
          if (renderer.options.follow !== 'free') {
            renderer.options = { ...renderer.options, follow: 'free' }
            latest.current.onUserCamera?.('free')
          }
        }
      } else if (pointers.size === 2) {
        pointers.set(event.pointerId, point)
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDistance > 0) renderer.camera.zoomAt(distance / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2)
        pinchDistance = distance
        moved = 10
      }
      pointers.set(event.pointerId, point)
    }
    const up = (event) => {
      const point = pointers.get(event.pointerId)
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinchDistance = 0
      if (point && moved <= 4 && latest.current.onPick) {
        const index = rendererRef.current.pick(point.x, point.y, latest.current.clock.time)
        if (index >= 0) latest.current.onPick(index)
      }
    }
    const wheel = (event) => {
      event.preventDefault()
      const point = position(event)
      const renderer = rendererRef.current
      if (renderer.options.follow === 'locked') return
      renderer.camera.zoomAt(Math.exp(-event.deltaY * 0.0014), point.x, point.y)
      if (renderer.options.follow === 'fit') {
        renderer.options = { ...renderer.options, follow: 'free' }
        latest.current.onUserCamera?.('free')
      }
    }
    const doubleClick = () => {
      const renderer = rendererRef.current
      renderer.setScene(renderer.scene)
      renderer.options = { ...renderer.options, follow: 'champion' }
      latest.current.onUserCamera?.('champion')
    }
    canvas.addEventListener('dblclick', doubleClick)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('dblclick', doubleClick)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [])

  return (
    <div className="arena" ref={containerRef}>
      <canvas ref={canvasRef} role="img" aria-label={label} data-testid="arena-canvas" />
      {children}
    </div>
  )
}
