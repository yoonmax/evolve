// Draws the exact polyline the workers collide with, plus a measuring scale and quiet
// parallax ridges behind it.
function ridge(ctx, camera, dpr, parallax, baseline, amplitude, wavelength, seed, color) {
  const { x: vx, y: vy, w, h } = camera.viewport
  const offset = camera.x * parallax
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(vx * dpr, (vy + h) * dpr)
  for (let px = 0; px <= w + 16; px += 16) {
    const u = (px / camera.zoom + offset) / wavelength + seed
    const y = Math.sin(u) * 0.62 + Math.sin(u * 2.17 + 1.3) * 0.28 + Math.sin(u * 4.6 + 4.1) * 0.1
    ctx.lineTo((vx + px) * dpr, (vy + h * baseline - y * amplitude) * dpr)
  }
  ctx.lineTo((vx + w + 16) * dpr, (vy + h) * dpr)
  ctx.closePath()
  ctx.fill()
}

export function drawBackdrop(ctx, camera, dpr, theme) {
  const { x, y, w, h } = camera.viewport
  ctx.fillStyle = theme.paper
  ctx.fillRect(x * dpr, y * dpr, w * dpr, h * dpr)
  ridge(ctx, camera, dpr, 0.12, 0.6, h * 0.06, 7.5, 1.7, theme.ridgeFar)
  ridge(ctx, camera, dpr, 0.3, 0.66, h * 0.045, 4.1, 5.2, theme.ridgeNear)
}

const LABEL_FONT = '"Hanken Grotesk Variable", system-ui, sans-serif'

export function drawTerrain(ctx, terrain, camera, dpr, theme, { showRuler = true, finishLine = null, startX = 0 } = {}) {
  const { x: vx, y: vy, w, h } = camera.viewport
  const left = camera.toWorldX(vx) - 1
  const right = camera.toWorldX(vx + w) + 1
  const xs = terrain.xs
  const ys = terrain.ys
  let first = 0
  while (first < xs.length - 1 && xs[first + 1] < left) first++
  let last = xs.length - 1
  while (last > 0 && xs[last - 1] > right) last--

  ctx.beginPath()
  ctx.moveTo(camera.toScreenX(xs[first]) * dpr, camera.toScreenY(ys[first]) * dpr)
  for (let i = first + 1; i <= last; i++) ctx.lineTo(camera.toScreenX(xs[i]) * dpr, camera.toScreenY(ys[i]) * dpr)
  ctx.lineTo(camera.toScreenX(xs[last]) * dpr, (vy + h) * dpr)
  ctx.lineTo(camera.toScreenX(xs[first]) * dpr, (vy + h) * dpr)
  ctx.closePath()
  ctx.fillStyle = theme.ground
  ctx.fill()

  // The base surface takes one colour; friction zones are drawn over it.
  ctx.beginPath()
  ctx.moveTo(camera.toScreenX(xs[first]) * dpr, camera.toScreenY(ys[first]) * dpr)
  for (let i = first + 1; i <= last; i++) ctx.lineTo(camera.toScreenX(xs[i]) * dpr, camera.toScreenY(ys[i]) * dpr)
  ctx.lineWidth = 1.6 * dpr
  ctx.lineJoin = 'round'
  ctx.strokeStyle = terrain.env.friction < 0.1 ? theme.ice : theme.groundLine
  ctx.stroke()

  for (const zone of terrain.zones) {
    if (zone.to < left || zone.from > right) continue
    if (zone.surface !== 'ice') continue
    ctx.beginPath()
    const from = Math.max(zone.from, left)
    const to = Math.min(zone.to, right)
    ctx.moveTo(camera.toScreenX(from) * dpr, camera.toScreenY(terrain.heightAt(from)) * dpr)
    for (let i = first; i <= last; i++) {
      if (xs[i] > from && xs[i] < to) ctx.lineTo(camera.toScreenX(xs[i]) * dpr, camera.toScreenY(ys[i]) * dpr)
    }
    ctx.lineTo(camera.toScreenX(to) * dpr, camera.toScreenY(terrain.heightAt(to)) * dpr)
    ctx.lineWidth = 3 * dpr
    ctx.strokeStyle = theme.ice
    ctx.stroke()
  }

  if (showRuler) drawRuler(ctx, terrain, camera, dpr, theme, left, right, startX)
  if (finishLine !== null) drawFlagLine(ctx, terrain, camera, dpr, theme, finishLine, 'finish', theme.ink)
}

function drawRuler(ctx, terrain, camera, dpr, theme, left, right, startX) {
  const major = camera.zoom < 26 ? 20 : camera.zoom < 60 ? 10 : 5
  const minor = camera.zoom < 26 ? 5 : camera.zoom < 60 ? 2 : 1
  const start = Math.ceil((left - startX) / minor) * minor
  ctx.font = `${11 * dpr}px ${LABEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineWidth = 1 * dpr
  for (let d = start; d + startX <= right; d += minor) {
    const wx = d + startX
    const sx = camera.toScreenX(wx) * dpr
    const sy = camera.toScreenY(terrain.heightAt(wx)) * dpr
    const isMajor = d % major === 0
    ctx.strokeStyle = isMajor ? theme.inkSoft : theme.tick
    ctx.beginPath()
    ctx.moveTo(sx, sy + 3 * dpr)
    ctx.lineTo(sx, sy + (isMajor ? 11 : 6) * dpr)
    ctx.stroke()
    if (isMajor) {
      ctx.fillStyle = d === 0 ? theme.ink : theme.inkSoft
      ctx.fillText(d === 0 ? 'start' : `${d} m`, sx, sy + 14 * dpr)
    }
  }
}

export function drawFlagLine(ctx, terrain, camera, dpr, theme, wx, label, color) {
  const sx = camera.toScreenX(wx) * dpr
  const sy = camera.toScreenY(terrain.heightAt(wx)) * dpr
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5 * dpr
  ctx.setLineDash([5 * dpr, 4 * dpr])
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(sx, sy - 150 * dpr)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = `600 ${12 * dpr}px ${LABEL_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = color
  ctx.fillText(label, sx + 6 * dpr, sy - 136 * dpr)
}
