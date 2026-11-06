// Pure terrain geometry: the UI thread uses it to draw and the workers to collide,
// so what you see is exactly the collision surface.
import { Rng, hashSeed } from '../lib/rng.js'
import { resolveEnvironment } from './Environments.js'

const X_MIN = -40
const X_MAX = 420
const RUNWAY_END = 2.5 // every terrain begins flat so that all creatures start alike

const ICE = 0.03

function flatProfile() {
  return [[X_MIN, 0], [X_MAX, 0]]
}

function hillsProfile(rng) {
  const waves = [0, 1, 2, 3].map((i) => ({
    amplitude: rng.range(0.1, 0.22) / (1 + i * 0.6),
    frequency: rng.range(0.28, 0.5) * (1 + i * 0.85),
    phase: rng.range(0, 6.283),
  }))
  const points = [[X_MIN, 0], [RUNWAY_END, 0]]
  const shift = waves.reduce((sum, w) => sum + w.amplitude * Math.sin(w.phase), 0)
  for (let x = RUNWAY_END + 0.5; x < X_MAX; x += 0.5) {
    const ramp = Math.min(1, (x - RUNWAY_END) / 6)
    let y = 0
    for (const w of waves) y += w.amplitude * Math.sin(w.frequency * (x - RUNWAY_END) + w.phase)
    points.push([x, ramp * (y - shift)])
  }
  return points
}

function obstaclesProfile(rng) {
  const points = [[X_MIN, 0], [RUNWAY_END + 1, 0]]
  let x = RUNWAY_END + 1
  while (x < X_MAX - 12) {
    x += rng.range(2.4, 4.6)
    if (rng.bool(0.68)) {
      // low wall with chamfered shoulders, so it can be climbed rather than only blocked
      const height = rng.range(0.08, 0.3)
      const width = rng.range(0.3, 0.8)
      points.push([x, 0], [x + 0.06, height], [x + 0.06 + width, height], [x + 0.12 + width, 0])
      x += 0.12 + width
    } else {
      const width = rng.range(0.3, 0.75)
      const depth = rng.range(0.25, 0.5)
      points.push([x, 0], [x + 0.05, -depth], [x + 0.05 + width, -depth], [x + 0.1 + width, 0])
      x += 0.1 + width
    }
  }
  points.push([X_MAX, 0])
  return points
}

function uphillProfile(rng) {
  const points = [[X_MIN, 0], [RUNWAY_END, 0]]
  let y = 0
  const wobblePhase = rng.range(0, 6.283)
  for (let x = RUNWAY_END + 1; x < X_MAX; x += 1) {
    const grade = Math.min(0.28, 0.05 + (x - RUNWAY_END) * 0.008)
    y += grade + 0.012 * Math.sin(x * 0.7 + wobblePhase)
    points.push([x, y])
  }
  return points
}

function stairsProfile(rng) {
  const points = [[X_MIN, 0], [RUNWAY_END, 0]]
  let x = RUNWAY_END
  let y = 0
  const rise = rng.range(0.07, 0.1)
  const run = rng.range(0.7, 0.95)
  while (x < X_MAX) {
    y += rise
    points.push([x + 0.03, y])
    x += run
    points.push([x, y])
  }
  return points
}

function mixedProfile(rng) {
  const points = [[X_MIN, 0], [RUNWAY_END, 0]]
  const zones = []
  let x = RUNWAY_END
  let y = 0
  const pushFlat = (length) => {
    x += length
    points.push([x, y])
  }
  while (x < X_MAX - 40) {
    pushFlat(rng.range(2.5, 4))
    const start = x
    const kind = ['bumps', 'ice', 'ramp', 'steps'][zones.length % 4]
    if (kind === 'bumps') {
      const end = x + rng.range(5, 8)
      const phase = rng.range(0, 6.283)
      while (x < end) {
        x += 0.5
        points.push([x, y + 0.14 * Math.sin((x - start) * 1.1 + phase) * Math.min(1, (x - start) / 1.5) * Math.min(1, (end - x) / 1.5)])
      }
      points.push([x + 0.5, y])
      x += 0.5
    } else if (kind === 'ice') {
      pushFlat(rng.range(5, 8))
      zones.push({ from: start, to: x, friction: ICE, surface: 'ice' })
      continue
    } else if (kind === 'ramp') {
      const grade = rng.range(0.1, 0.18)
      const length = rng.range(4, 7)
      x += length
      y += grade * length
      points.push([x, y])
    } else {
      for (let i = 0; i < 6; i++) {
        y += 0.08
        points.push([x + 0.03, y])
        x += 0.8
        points.push([x, y])
      }
    }
    zones.push({ from: start, to: x, friction: null, surface: kind })
  }
  points.push([X_MAX, y])
  return { points, zones: zones.filter((zone) => zone.friction !== null) }
}

const PROFILES = {
  flat: flatProfile,
  hills: hillsProfile,
  obstacles: obstaclesProfile,
  uphill: uphillProfile,
  stairs: stairsProfile,
  mixed: mixedProfile,
}

/**
 * Splits a polyline into contiguous pieces by friction, so that each piece can be one
 * static chain fixture carrying its own friction coefficient.
 */
function sliceByZones(xs, ys, zones, baseFriction) {
  if (!zones.length) return [{ friction: baseFriction, surface: baseFriction < 0.1 ? 'ice' : 'ground', xs: [...xs], ys: [...ys] }]
  const pieces = []
  const heightAt = makeHeightAt(xs, ys)
  let cursor = xs[0]
  const addPiece = (from, to, friction, surface) => {
    const px = [from]
    const py = [heightAt(from)]
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] > from + 1e-6 && xs[i] < to - 1e-6) {
        px.push(xs[i])
        py.push(ys[i])
      }
    }
    px.push(to)
    py.push(heightAt(to))
    pieces.push({ friction, surface, xs: px, ys: py })
  }
  for (const zone of zones) {
    if (zone.from > cursor) addPiece(cursor, zone.from, baseFriction, 'ground')
    addPiece(zone.from, zone.to, zone.friction, zone.surface)
    cursor = zone.to
  }
  addPiece(cursor, xs[xs.length - 1], baseFriction, 'ground')
  return pieces
}

function makeHeightAt(xs, ys) {
  return (x) => {
    if (x <= xs[0]) return ys[0]
    const last = xs.length - 1
    if (x >= xs[last]) return ys[last]
    let lo = 0
    let hi = last
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const span = xs[hi] - xs[lo]
    return span <= 0 ? ys[hi] : ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span
  }
}

/** Pure function of environment id and seed. */
export function buildTerrain(envConfig) {
  const env = resolveEnvironment(envConfig)
  const rng = new Rng(hashSeed('terrain', env.terrain, env.seed))
  const profile = PROFILES[env.terrain](rng)
  const points = Array.isArray(profile) ? profile : profile.points
  const zones = Array.isArray(profile) ? [] : profile.zones
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const heightAt = makeHeightAt(xs, ys)
  const pieces = sliceByZones(xs, ys, zones, env.friction)
  return {
    env,
    xs,
    ys,
    zones,
    pieces,
    heightAt,
    xMin: xs[0],
    xMax: xs[xs.length - 1],
    frictionAt(x) {
      for (const zone of zones) if (x >= zone.from && x < zone.to) return zone.friction
      return env.friction
    },
  }
}

const cache = new Map()

/** Terrain is deterministic and immutable, so workers and renderers can share a copy. */
export function terrainFor(envConfig) {
  const env = resolveEnvironment(envConfig)
  const key = `${env.terrain}:${env.seed}:${env.friction}`
  let terrain = cache.get(key)
  if (!terrain) {
    terrain = buildTerrain(envConfig)
    if (cache.size > 24) cache.clear()
    cache.set(key, terrain)
  }
  return terrain
}
