// Decodes a genome into a phenotype: where each body part sits in its rest pose, and how
// much it weighs. Pure maths with no physics engine, so the UI can draw thumbnails and
// the editor can hit-test from the same geometry the workers simulate.

export function shapeArea(segment) {
  const { shape, w, h } = segment
  if (shape === 'circle') return (Math.PI * w * w) / 4
  if (shape === 'capsule') {
    const thick = Math.min(h, w)
    return (w - thick) * thick + (Math.PI * thick * thick) / 4
  }
  // chamfered box
  const c = chamferOf(segment)
  return w * h - 2 * c * c
}

export function chamferOf(segment) {
  return Math.min(segment.w, segment.h) * 0.18
}

/** Outline of a box segment in local coordinates, the same polygon the solver collides. */
export function boxVertices(segment) {
  const hx = segment.w / 2
  const hy = segment.h / 2
  const c = chamferOf(segment)
  return [
    [hx - c, -hy], [hx, -hy + c], [hx, hy - c], [hx - c, hy],
    [-hx + c, hy], [-hx, hy - c], [-hx, -hy + c], [-hx + c, -hy],
  ]
}

export function anchorPoint(segment, anchor) {
  return { x: (anchor.u * segment.w) / 2, y: (anchor.v * (segment.shape === 'circle' ? segment.w : segment.h)) / 2 }
}

function extremePoints(segment) {
  if (segment.shape === 'circle') return { r: segment.w / 2, points: [[0, 0]] }
  if (segment.shape === 'capsule') {
    const thick = Math.min(segment.h, segment.w)
    const half = (segment.w - thick) / 2
    return { r: thick / 2, points: [[-half, 0], [half, 0]] }
  }
  return { r: 0, points: boxVertices(segment) }
}

/**
 * Lays the tree out from the root. The returned coordinates are relative to a root at
 * the origin, then shifted so that the lowest point rests at y = 0 and the centre of mass
 * sits at x = 0.
 */
export function decodeGenome(genome, { centered = true } = {}) {
  const parts = []
  for (let i = 0; i < genome.segments.length; i++) {
    const segment = genome.segments[i]
    if (segment.parent === null || segment.parent === undefined) {
      parts.push({ index: i, segment, x: 0, y: 0, angle: genome.rootAngle ?? 0, anchor: null })
      continue
    }
    const parent = parts[segment.parent]
    const joint = segment.joint
    const pa = anchorPoint(parent.segment, joint.anchorParent)
    const ca = anchorPoint(segment, joint.anchorChild)
    const cosP = Math.cos(parent.angle)
    const sinP = Math.sin(parent.angle)
    const ax = parent.x + pa.x * cosP - pa.y * sinP
    const ay = parent.y + pa.x * sinP + pa.y * cosP
    const angle = parent.angle + joint.rest
    const cosC = Math.cos(angle)
    const sinC = Math.sin(angle)
    parts.push({
      index: i,
      segment,
      x: ax - (ca.x * cosC - ca.y * sinC),
      y: ay - (ca.x * sinC + ca.y * cosC),
      angle,
      anchor: { x: ax, y: ay },
    })
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let mass = 0
  let massX = 0
  let massY = 0
  for (const part of parts) {
    const { r, points } = extremePoints(part.segment)
    const cos = Math.cos(part.angle)
    const sin = Math.sin(part.angle)
    for (const [lx, ly] of points) {
      const wx = part.x + lx * cos - ly * sin
      const wy = part.y + lx * sin + ly * cos
      if (wx - r < minX) minX = wx - r
      if (wx + r > maxX) maxX = wx + r
      if (wy - r < minY) minY = wy - r
      if (wy + r > maxY) maxY = wy + r
    }
    const m = part.segment.density * shapeArea(part.segment)
    part.mass = m
    mass += m
    massX += m * part.x
    massY += m * part.y
  }
  const comX = centered ? massX / mass : 0
  const shiftY = centered ? -minY : 0
  for (const part of parts) {
    part.x -= comX
    part.y += shiftY
    if (part.anchor) {
      part.anchor.x -= comX
      part.anchor.y += shiftY
    }
  }
  return {
    parts,
    mass,
    com: { x: 0, y: massY / mass + shiftY },
    bounds: { minX: minX - comX, maxX: maxX - comX, minY: minY + shiftY, maxY: maxY + shiftY },
    width: maxX - minX,
    height: maxY - minY,
  }
}
