// Composes one frame of the arena. A scene is a set of tracks and a layout:
//   overlay  every creature in one world, the leader solid and the others ghosted
//   grid     one small viewport per creature, each following its own
//   lanes    stacked lanes that share an x axis, for races
// Tracks never interact: each was simulated alone in its own world.
import { Camera, defaultZoomFor } from './CameraController.js'
import { comAt, frameAt, poseAt, distanceAt } from './Track.js'
import { drawBackdrop, drawFlagLine, drawTerrain } from './TerrainRenderer.js'
import { drawCreature, makeArt } from './CreatureRenderer.js'
import { drawDebug, viewOf } from './DebugRenderer.js'
import { terrainFor } from '../physics/Terrain.js'

const frame = { a: 0, b: 0, t: 0 }
const pose = { x: 0, y: 0, angle: 0 }
const LABEL_FONT = '"Hanken Grotesk Variable", system-ui, sans-serif'

export function readTheme(element = document.documentElement) {
  const css = getComputedStyle(element)
  const get = (name) => css.getPropertyValue(name).trim()
  return {
    paper: get('--paper'), ink: get('--ink'), inkSoft: get('--ink-soft'), tick: get('--tick'), ground: get('--ground'),
    groundLine: get('--ground-line'), ridgeFar: get('--ridge-far'), ridgeNear: get('--ridge-near'), ice: get('--ice'),
    accent: get('--accent'), debug: get('--debug'), contact: get('--contact'), motorPlus: get('--motor-plus'), motorMinus: get('--motor-minus'),
    shadow: get('--shadow'),
  }
}

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.dpr = 1
    this.width = 1
    this.height = 1
    this.camera = new Camera()
    this.laneCameras = []
    this.scene = null
    this.theme = readTheme()
    this.options = { follow: 'leader', trails: true, debug: null, ruler: true }
    this.needsSnap = true
    this.lastLeader = 0
  }

  resize(width, height, dpr) {
    this.dpr = dpr
    this.width = width
    this.height = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.camera.setViewport(0, 0, width, height)
    const zoom = defaultZoomFor(height) * (this.scene?.zoomScale ?? 1)
    this.camera.targetZoom = zoom
    this.camera.zoom = zoom
    this.needsSnap = true
  }

  setScene(scene, { keepCamera = false } = {}) {
    this.scene = scene
    if (scene) {
      for (const track of scene.tracks) if (!track.art) track.art = makeArt(track.genome)
      this.terrain = terrainFor(scene.env)
      if (!keepCamera) {
        this.camera.targetZoom = defaultZoomFor(this.height) * (scene.zoomScale ?? 1)
        this.needsSnap = true
      }
    }
  }

  leaderIndex(time) {
    const tracks = this.scene.tracks
    let best = 0
    let bestX = -Infinity
    for (let i = 0; i < tracks.length; i++) {
      const x = comAt(tracks[i], time).x
      if (x > bestX) {
        bestX = x
        best = i
      }
    }
    return best
  }

  focusIndex(time) {
    const { tracks } = this.scene
    const follow = this.options.follow
    if (follow === 'selected' && this.scene.selected !== undefined && tracks[this.scene.selected]) return this.scene.selected
    if (follow === 'champion') {
      const champion = tracks.findIndex((track) => track.role === 'champion')
      return champion >= 0 ? champion : 0
    }
    return this.leaderIndex(time)
  }

  render(time, dtReal) {
    const { ctx, dpr, scene } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (!scene || !scene.tracks.length) {
      ctx.fillStyle = this.theme.paper
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
      return
    }
    const layout = scene.layout ?? 'overlay'
    if (layout === 'overlay') this.renderOverlay(time, dtReal)
    else this.renderTiled(time, dtReal, layout)
    this.needsSnap = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    void dpr
  }

  updateCamera(camera, targetTrack, time, dtReal) {
    const follow = this.options.follow
    if (follow !== 'free' && follow !== 'locked') {
      const c = comAt(targetTrack, time)
      camera.targetX = c.x + (camera.viewport.w * 0.08) / camera.zoom
      const ground = this.terrain.heightAt(c.x)
      camera.targetY = ground + Math.max(0, (c.y - ground) - 2.2) * 0.6
    } else if (follow === 'locked' && this.needsSnap) {
      camera.targetX = this.scene.lockX ?? 0
    }
    if (follow === 'fit') {
      let min = Infinity
      let max = -Infinity
      for (const track of this.scene.tracks) {
        const x = comAt(track, time).x
        if (x < min) min = x
        if (x > max) max = x
      }
      camera.targetX = (min + max) / 2
      const span = Math.max(4, max - min + 4)
      camera.targetZoom = Math.max(14, Math.min(defaultZoomFor(this.height), camera.viewport.w / span))
    }
    if (this.needsSnap) camera.snap()
    else camera.update(Math.min(dtReal, 0.1))
  }

  renderOverlay(time, dtReal) {
    const { ctx, dpr, scene, theme, camera, terrain } = this
    const focus = this.focusIndex(time)
    this.lastLeader = this.leaderIndex(time)
    this.updateCamera(camera, scene.tracks[focus], time, dtReal)
    drawBackdrop(ctx, camera, dpr, theme)
    const startX = scene.rulerOrigin ?? 0
    drawTerrain(ctx, terrain, camera, dpr, theme, { showRuler: this.options.ruler, finishLine: scene.finishLine ?? null, startX })
    if (scene.record && scene.record > 0.5) {
      drawFlagLine(ctx, terrain, camera, dpr, theme, startX + scene.record, `best so far, ${scene.record.toFixed(1)} m`, theme.accent)
    }
    const view = viewOf(camera, dpr)
    const hero = this.options.follow === 'selected' ? focus : scene.heroIndex ?? this.lastLeader

    const n = scene.tracks.length
    for (let i = n - 1; i >= 0; i--) {
      const track = scene.tracks[i]
      if (i === hero) continue
      this.drawTrack(track, time, view, { alpha: scene.ghostAlpha ?? 0.3, joints: false, eye: n <= 8, shadow: scene.ghostShadows })
    }
    const heroTrack = scene.tracks[hero]
    if (this.options.trails) this.drawTrail(heroTrack, time)
    this.drawTrack(heroTrack, time, view, { alpha: 1, joints: true, eye: true, shadow: true })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (this.options.debug) drawDebug(ctx, heroTrack, heroTrack.art, time, camera, dpr, theme, this.options.debug)
    if (scene.nameTags) this.drawNameTags(time, hero)
  }

  renderTiled(time, dtReal, layout) {
    const { ctx, dpr, scene, theme, width, height, terrain } = this
    const n = scene.tracks.length
    const lanes = layout === 'lanes'
    const cols = lanes ? 1 : scene.columns ?? Math.min(n, Math.ceil(Math.sqrt((n * width) / Math.max(1, height))))
    const rows = Math.ceil(n / cols)
    const cw = width / cols
    const ch = height / rows
    while (this.laneCameras.length < n) this.laneCameras.push(new Camera())
    const leader = this.leaderIndex(time)
    this.lastLeader = leader
    for (let i = 0; i < n; i++) {
      const track = scene.tracks[i]
      const camera = this.laneCameras[i]
      const col = i % cols
      const row = Math.floor(i / cols)
      camera.setViewport(col * cw, row * ch, cw, ch)
      camera.anchorY = lanes ? 0.74 : 0.7
      const baseZoom = lanes ? Math.max(28, Math.min(90, ch / 2.6)) : Math.max(24, Math.min(110, Math.min(cw / 5, ch / 3.2)))
      camera.targetZoom = baseZoom * (scene.zoomScale ?? 1)
      if (this.needsSnap || camera.zoom === 110) camera.zoom = camera.targetZoom
      const target = lanes ? scene.tracks[leader] : track
      const c = comAt(target, time)
      camera.targetX = c.x + (lanes ? cw * 0.18 / camera.zoom : 0)
      const own = comAt(track, time)
      camera.targetY = terrain.heightAt(lanes ? own.x : c.x)
      if (this.needsSnap) camera.snap()
      else camera.update(Math.min(dtReal, 0.1))

      ctx.save()
      ctx.beginPath()
      ctx.rect(col * cw * dpr, row * ch * dpr, cw * dpr, ch * dpr)
      ctx.clip()
      drawBackdrop(ctx, camera, dpr, theme)
      drawTerrain(ctx, terrain, camera, dpr, theme, { showRuler: this.options.ruler, finishLine: scene.finishLine ?? null, startX: scene.rulerOrigin ?? 0 })
      const view = viewOf(camera, dpr)
      if (this.options.trails && (n <= 4 || lanes)) this.drawTrail(track, time, camera)
      this.drawTrack(track, time, view, { alpha: 1, joints: n <= 4, eye: true, shadow: true }, camera)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (this.options.debug && n <= 2) drawDebug(ctx, track, track.art, time, camera, dpr, theme, this.options.debug)
      ctx.restore()

      // cell label: the only chrome tiled views need
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.font = `600 ${12 * dpr}px ${LABEL_FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = theme.ink
      const label = track.label ?? track.genome.name
      const d = distanceAt(track, time)
      ctx.fillText(lanes ? `${i + 1}  ${label}` : label, (col * cw + 12) * dpr, (row * ch + 10) * dpr)
      ctx.font = `${12 * dpr}px ${LABEL_FONT}`
      ctx.fillStyle = theme.inkSoft
      ctx.fillText(`${d.toFixed(1)} m`, (col * cw + 12) * dpr, (row * ch + 26) * dpr)
      if (i > 0 && (lanes || row > 0) && col === 0) {
        ctx.fillStyle = theme.tick
        ctx.fillRect(0, row * ch * dpr, width * dpr, 1 * dpr)
      }
      if (col > 0) {
        ctx.fillStyle = theme.tick
        ctx.fillRect(col * cw * dpr, row * ch * dpr, 1 * dpr, ch * dpr)
      }
    }
  }

  drawShadow(track, time, camera) {
    const { ctx, dpr, terrain, theme } = this
    const c = comAt(track, time)
    const ground = terrain.heightAt(c.x)
    const lift = Math.max(0, c.y - ground)
    const spread = Math.max(0.3, track.phenotype.width * 0.5) * (1 + lift * 0.2) * camera.zoom * dpr
    const strength = Math.max(0.05, 0.3 - lift * 0.08)
    const sx = camera.toScreenX(c.x) * dpr
    const sy = camera.toScreenY(ground) * dpr + 1.5 * dpr
    ctx.save()
    ctx.setTransform(1, 0, 0, 0.14, sx, sy)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, spread)
    gradient.addColorStop(0, withAlpha(theme.shadow, strength))
    gradient.addColorStop(1, withAlpha(theme.shadow, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(0, 0, spread, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawTrack(track, time, view, style, camera = this.camera) {
    const { ctx, theme } = this
    if (style.shadow) this.drawShadow(track, time, camera)
    frameAt(track, time, frame)
    const getPose = (i) => poseAt(track, i, frame, pose)
    drawCreature(ctx, track.art, getPose, view, { ...style, paper: theme.paper, jointColor: theme.ink, outline: style.alpha < 1 ? null : 'rgba(25,25,25,0.2)' })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  drawNameTags(time, hero) {
    const { ctx, dpr, camera, theme, scene } = this
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    scene.tracks.forEach((track, i) => {
      const c = comAt(track, time)
      const top = c.y + track.phenotype.height * 0.5 + 0.28
      ctx.font = `${i === hero ? 700 : 500} ${13 * dpr}px ${LABEL_FONT}`
      ctx.fillStyle = i === hero ? theme.ink : theme.inkSoft
      ctx.fillText(track.label, camera.toScreenX(c.x) * dpr, camera.toScreenY(top) * dpr)
    })
  }

  /** Centre-of-mass path so far, taken directly from the recording. */
  drawTrail(track, time, camera = this.camera) {
    const { ctx, dpr, theme } = this
    const r = track.recording
    frameAt(track, time, frame)
    const lastFrame = frame.a
    const windowFrames = Math.round(4 / r.frameDt)
    const first = Math.max(0, lastFrame - windowFrames)
    const stride = Math.max(2, Math.round(0.05 / r.frameDt))
    ctx.lineWidth = 1.5 * dpr
    ctx.lineCap = 'round'
    let prevX = null
    let prevY = null
    for (let f = first; f <= lastFrame; f += stride) {
      const sx = camera.toScreenX(r.com[f * 2]) * dpr
      const sy = camera.toScreenY(r.com[f * 2 + 1]) * dpr
      if (prevX !== null) {
        ctx.globalAlpha = 0.5 * ((f - first) / Math.max(1, lastFrame - first))
        ctx.strokeStyle = theme.accent
        ctx.beginPath()
        ctx.moveTo(prevX, prevY)
        ctx.lineTo(sx, sy)
        ctx.stroke()
      }
      prevX = sx
      prevY = sy
    }
    ctx.globalAlpha = 1
  }

  /** Which track is under a screen point, using real body positions at this time. */
  pick(px, py, time) {
    if (!this.scene || (this.scene.layout ?? 'overlay') !== 'overlay') return -1
    const wx = this.camera.toWorldX(px)
    const wy = this.camera.toWorldY(py)
    let best = -1
    let bestDistance = 0.5
    this.scene.tracks.forEach((track, index) => {
      frameAt(track, time, frame)
      for (let i = 0; i < track.recording.bodyCount; i++) {
        poseAt(track, i, frame, pose)
        const d = Math.hypot(pose.x - wx, pose.y - wy) - track.genome.segments[i].w * 0.3
        if (d < bestDistance) {
          bestDistance = d
          best = index
        }
      }
    })
    return best
  }
}

function withAlpha(color, alpha) {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}
