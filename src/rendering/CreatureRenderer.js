// Draws bodies from their true collision geometry: each path below is the same outline
// CreatureBody.js gives the solver.
import { boxVertices, decodeGenome } from '../creatures/GenomeDecoder.js'
import { anchorPoint } from '../creatures/GenomeDecoder.js'

export function segmentPath(segment) {
  const path = new Path2D()
  if (segment.shape === 'circle') {
    path.arc(0, 0, segment.w / 2, 0, Math.PI * 2)
  } else if (segment.shape === 'capsule') {
    const thick = Math.min(segment.h, segment.w)
    const half = (segment.w - thick) / 2
    const r = thick / 2
    path.arc(half, 0, r, -Math.PI / 2, Math.PI / 2)
    path.arc(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2)
    path.closePath()
  } else {
    const vertices = boxVertices(segment)
    path.moveTo(vertices[0][0], vertices[0][1])
    for (let i = 1; i < vertices.length; i++) path.lineTo(vertices[i][0], vertices[i][1])
    path.closePath()
  }
  return path
}

export function makeArt(genome) {
  return {
    pieces: genome.segments.map((segment) => ({ path: segmentPath(segment), color: segment.color, segment })),
    // draw roots last, so that limbs tuck behind the body
    order: genome.segments.map((_, index) => genome.segments.length - 1 - index),
    joints: genome.segments.map((segment, index) => {
      if (index === 0) return null
      return { local: anchorPoint(segment, segment.joint.anchorChild) }
    }),
    eye: eyeFor(genome.segments[0]),
  }
}

function eyeFor(root) {
  if (root.shape === 'circle') return { x: root.w * 0.14, y: root.w * 0.14, r: Math.max(0.03, root.w * 0.1) }
  const thick = root.shape === 'capsule' ? Math.min(root.h, root.w) : root.h
  return { x: root.w * 0.32, y: thick * 0.14, r: Math.max(0.025, Math.min(0.05, thick * 0.2)) }
}

/**
 * Draws one creature from poses in world coordinates.
 * @param view {k: device px per metre, ox, oy: world→device origin}
 * @param getPose (i) → {x, y, angle}
 */
export function drawCreature(ctx, art, getPose, view, style = {}) {
  const { alpha = 1, joints = true, eye = true, flat = null, outline = 'rgba(30,30,30,0.22)', paper = '#ffffff', jointColor = '#2a2b2d', highlight = null } = style
  const { k, ox, oy } = view
  ctx.globalAlpha = alpha
  for (const index of art.order) {
    const pose = getPose(index)
    const cos = Math.cos(pose.angle)
    const sin = Math.sin(pose.angle)
    ctx.setTransform(k * cos, -k * sin, -k * sin, -k * cos, ox + pose.x * k, oy - pose.y * k)
    const piece = art.pieces[index]
    ctx.fillStyle = flat ?? piece.color
    ctx.fill(piece.path)
    if (outline) {
      ctx.lineWidth = 1 / k * (view.dpr ?? 1)
      ctx.strokeStyle = highlight === index ? '#ffffff' : outline
      ctx.stroke(piece.path)
    }
    if (joints && art.joints[index]) {
      const { local } = art.joints[index]
      const r = Math.max(0.018, Math.min(0.03, piece.segment.h * 0.2))
      ctx.beginPath()
      ctx.arc(local.x, local.y, r, 0, Math.PI * 2)
      ctx.fillStyle = paper
      ctx.fill()
      ctx.lineWidth = r * 0.45
      ctx.strokeStyle = jointColor
      ctx.stroke()
    }
    if (eye && index === 0 && art.eye) {
      const e = art.eye
      ctx.beginPath()
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2)
      ctx.fillStyle = '#fbfaf5'
      ctx.fill()
      // the pupil always looks along +x in the world: forward, where the fitness is
      const lookX = cos * e.r * 0.34
      const lookY = -sin * e.r * 0.34
      ctx.beginPath()
      ctx.arc(e.x + lookX, e.y + lookY, e.r * 0.54, 0, Math.PI * 2)
      ctx.fillStyle = '#1f2023'
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

/** Draws a creature in its rest pose inside a box, for thumbnails and the lineage. */
export function drawGenomeThumb(ctx, genome, { x, y, width, height, scale = null, flat = null, anchor = 'center', dpr = 1, paper = '#ffffff', alpha = 1, joints = false, eye = true }) {
  const phenotype = decodeGenome(genome)
  const art = makeArt(genome)
  const fit = scale ?? Math.min(width / Math.max(phenotype.width, 0.4), height / Math.max(phenotype.height, 0.4)) * 0.88
  const k = fit * dpr
  const cx = (phenotype.bounds.minX + phenotype.bounds.maxX) / 2
  const ox = (x + width / 2) * dpr - cx * k
  const oy = anchor === 'bottom' ? (y + height) * dpr : (y + height / 2) * dpr + (phenotype.height / 2) * k
  const getPose = (i) => phenotype.parts[i]
  ctx.save()
  drawCreature(ctx, art, getPose, { k, ox, oy, dpr }, { flat, joints, eye, outline: flat ? null : 'rgba(30,30,30,0.2)', paper, alpha })
  ctx.restore()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return { width: phenotype.width * fit, height: phenotype.height * fit }
}
