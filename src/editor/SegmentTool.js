// Pure operations on a genome's body graph. Each returns a mutated copy or changes the
// draft it is handed; none touches the UI, which keeps them directly testable.
import { BOUNDS, DEFAULT_JOINT, DEFAULT_OSC, DEFAULT_SEGMENT, cloneGenome } from '../creatures/Genome.js'
import { MAX_SEGMENTS } from '../physics/constants.js'
import { clamp } from '../lib/math.js'

export function childrenOf(genome, index) {
  const children = []
  genome.segments.forEach((segment, i) => {
    if (segment.parent === index) children.push(i)
  })
  return children
}

export function descendantsOf(genome, index) {
  const found = new Set([index])
  genome.segments.forEach((segment, i) => {
    if (segment.parent !== null && found.has(segment.parent)) found.add(i)
  })
  found.delete(index)
  return found
}

export function makeLimb(genome, parent, anchorParent, rest, overrides = {}) {
  const parentSegment = genome.segments[parent]
  return {
    id: `s${genome.segments.length}`,
    ...DEFAULT_SEGMENT,
    w: 0.42,
    h: 0.12,
    color: parentSegment.color,
    parent,
    joint: {
      anchorParent,
      anchorChild: { u: -0.85, v: 0 },
      ...DEFAULT_JOINT,
      rest,
      osc: { ...DEFAULT_OSC, phase: (genome.segments.length * 1.1) % 3.1 },
    },
    ...overrides,
  }
}

/** Adds a child of `parent`. Returns the new index, or -1 at the size limit. */
export function addSegment(genome, parent, { u = 0.85, v = 0, rest = 0 } = {}) {
  if (genome.segments.length >= MAX_SEGMENTS) return -1
  genome.segments.push(makeLimb(genome, parent, { u: clamp(u, -1, 1), v: clamp(v, -1, 1) }, rest))
  return genome.segments.length - 1
}

/** Removes a segment and everything attached to it. Returns how many were removed. */
export function removeSegment(genome, index) {
  if (index <= 0 || index >= genome.segments.length) return 0
  const doomed = descendantsOf(genome, index)
  doomed.add(index)
  remapSegments(genome, (i) => !doomed.has(i))
  return doomed.size
}

function remapSegments(genome, keep) {
  const mapping = new Map()
  const kept = []
  genome.segments.forEach((segment, i) => {
    if (keep(i)) {
      mapping.set(i, kept.length)
      kept.push(segment)
    }
  })
  for (const segment of kept) {
    if (segment.parent !== null) segment.parent = mapping.get(segment.parent)
  }
  kept.forEach((segment, i) => {
    segment.id = `s${i}`
  })
  genome.segments = kept
  return mapping
}

/** Copies a segment and its subtree onto the same parent, mirrored across its long axis. */
export function duplicateSegment(genome, index) {
  if (index <= 0) return -1
  const subtree = [index, ...descendantsOf(genome, index)].sort((a, b) => a - b)
  if (genome.segments.length + subtree.length > MAX_SEGMENTS) return -1
  const mapping = new Map()
  const start = genome.segments.length
  subtree.forEach((old, i) => mapping.set(old, start + i))
  const copies = subtree.map((old) => {
    const copy = cloneGenome({ segments: [genome.segments[old]] }).segments[0]
    copy.parent = old === index ? genome.segments[index].parent : mapping.get(genome.segments[old].parent)
    return copy
  })
  const first = copies[0]
  first.joint.anchorParent.u = clamp(-first.joint.anchorParent.u || 0.3, -1, 1)
  first.joint.osc.phase = ((first.joint.osc.phase + Math.PI + Math.PI) % (2 * Math.PI)) - Math.PI
  genome.segments.push(...copies)
  genome.segments.forEach((segment, i) => {
    segment.id = `s${i}`
  })
  return start
}

/** Reconnects a segment to a new parent, keeping the rooted tree valid. */
export function reparentSegment(genome, index, newParent) {
  if (index <= 0 || newParent === index || descendantsOf(genome, index).has(newParent)) return false
  genome.segments[index].parent = newParent
  sortTopologically(genome)
  return true
}

/** Restores the parent-before-child order the decoder relies on. */
export function sortTopologically(genome) {
  const order = []
  const visit = (i) => {
    order.push(i)
    childrenOf(genome, i).forEach(visit)
  }
  visit(0)
  const mapping = new Map(order.map((old, next) => [old, next]))
  const sorted = order.map((old) => genome.segments[old])
  for (const segment of sorted) {
    if (segment.parent !== null) segment.parent = mapping.get(segment.parent)
  }
  sorted.forEach((segment, i) => {
    segment.id = `s${i}`
  })
  genome.segments = sorted
  return mapping
}

export function clampDimension(value, kind) {
  return clamp(value, BOUNDS[kind][0], BOUNDS[kind][1])
}

export function setShape(segment, shape) {
  segment.shape = shape
  if (shape === 'circle') {
    segment.w = Math.min(segment.w, 0.9)
    segment.h = segment.w
  } else if (shape === 'capsule') {
    segment.h = Math.min(segment.h, segment.w, BOUNDS.h[1])
  } else {
    segment.h = Math.min(segment.h, BOUNDS.h[1])
  }
}

export function blankCreature() {
  const genome = {
    schema: 1,
    name: 'my creature',
    rootAngle: 0,
    controller: { type: 'oscillator', frequency: 1, neural: null },
    segments: [{ id: 's0', shape: 'capsule', w: 0.9, h: 0.28, density: 12, friction: 0.9, restitution: 0.05, color: '#6F8F5A', parent: null, joint: null }],
  }
  addSegment(genome, 0, { u: -0.7, v: -0.8, rest: -Math.PI / 2 })
  addSegment(genome, 0, { u: 0.7, v: -0.8, rest: -Math.PI / 2 })
  genome.segments[2].joint.osc.phase = 2.4
  return genome
}

/** Hit test in segment-local coordinates. */
export function pointInSegment(segment, lx, ly, margin = 0) {
  if (segment.shape === 'circle') return lx * lx + ly * ly <= (segment.w / 2 + margin) ** 2
  if (segment.shape === 'capsule') {
    const thick = Math.min(segment.h, segment.w)
    const half = (segment.w - thick) / 2
    const px = clamp(lx, -half, half)
    return (lx - px) ** 2 + ly * ly <= (thick / 2 + margin) ** 2
  }
  return Math.abs(lx) <= segment.w / 2 + margin && Math.abs(ly) <= segment.h / 2 + margin
}
