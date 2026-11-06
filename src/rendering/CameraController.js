// World ↔ screen conversion and smooth tracking. Metres in, pixels out.
export class Camera {
  constructor() {
    this.x = 0
    this.y = 0.6
    this.zoom = 110 // pixels per metre
    this.targetX = 0
    this.targetY = 0.6
    this.targetZoom = 110
    this.viewport = { x: 0, y: 0, w: 1, h: 1 }
    this.anchorY = 0.8 // where the ground line sits, as a fraction of height
  }

  setViewport(x, y, w, h) {
    this.viewport.x = x
    this.viewport.y = y
    this.viewport.w = w
    this.viewport.h = h
  }

  /** Eases towards the target. Frame-rate independent exponential smoothing. */
  update(dt, stiffness = 5) {
    const k = 1 - Math.exp(-stiffness * dt)
    this.x += (this.targetX - this.x) * k
    this.y += (this.targetY - this.y) * k
    this.zoom += (this.targetZoom - this.zoom) * k
  }

  snap() {
    this.x = this.targetX
    this.y = this.targetY
    this.zoom = this.targetZoom
  }

  toScreenX(wx) {
    return this.viewport.x + this.viewport.w * 0.5 + (wx - this.x) * this.zoom
  }

  toScreenY(wy) {
    return this.viewport.y + this.viewport.h * this.anchorY - (wy - this.y) * this.zoom
  }

  toWorldX(sx) {
    return (sx - this.viewport.x - this.viewport.w * 0.5) / this.zoom + this.x
  }

  toWorldY(sy) {
    return this.y - (sy - this.viewport.y - this.viewport.h * this.anchorY) / this.zoom
  }

  panBy(dxPixels, dyPixels) {
    this.targetX -= dxPixels / this.zoom
    this.targetY += dyPixels / this.zoom
    this.x = this.targetX
    this.y = this.targetY
  }

  zoomAt(factor, sx, sy) {
    const wx = this.toWorldX(sx)
    const wy = this.toWorldY(sy)
    this.targetZoom = Math.max(14, Math.min(320, this.targetZoom * factor))
    this.zoom = this.targetZoom
    this.targetX = wx - (sx - this.viewport.x - this.viewport.w * 0.5) / this.zoom
    this.targetY = wy + (sy - this.viewport.y - this.viewport.h * this.anchorY) / this.zoom
    this.x = this.targetX
    this.y = this.targetY
  }
}

export function defaultZoomFor(height) {
  return Math.max(46, Math.min(170, height / 5.6))
}
