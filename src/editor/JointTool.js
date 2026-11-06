// Converting pointer positions in the world into normalised joint anchors and angles.
import { clamp, wrapAngle } from '../lib/math.js'

export function worldToLocal(part, wx, wy) {
  const dx = wx - part.x
  const dy = wy - part.y
  const cos = Math.cos(part.angle)
  const sin = Math.sin(part.angle)
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
}

export function localToAnchor(segment, local) {
  const height = segment.shape === 'circle' ? segment.w : segment.h
  return { u: clamp((2 * local.x) / segment.w, -1, 1), v: clamp((2 * local.y) / height, -1, 1) }
}

const snapTo = (value, step) => Math.round(value / step) * step

/** Moves a whole limb: the child keeps its own anchor, the parent's anchor slides. */
export function moveAttachment(genome, parts, index, wx, wy, snap) {
  const segment = genome.segments[index]
  const parent = parts[segment.parent]
  const anchor = localToAnchor(parent.segment, worldToLocal(parent, wx, wy))
  segment.joint.anchorParent = snap ? { u: snapTo(anchor.u, 0.05), v: snapTo(anchor.v, 0.05) } : anchor
}

/** Moves the pivot itself while the child stays where it is. */
export function moveJoint(genome, parts, index, wx, wy, snap) {
  const part = parts[index]
  const segment = genome.segments[index]
  const parent = parts[segment.parent]
  const onChild = localToAnchor(part.segment, worldToLocal(part, wx, wy))
  const onParent = localToAnchor(parent.segment, worldToLocal(parent, wx, wy))
  segment.joint.anchorChild = snap ? { u: snapTo(onChild.u, 0.05), v: snapTo(onChild.v, 0.05) } : onChild
  segment.joint.anchorParent = snap ? { u: snapTo(onParent.u, 0.05), v: snapTo(onParent.v, 0.05) } : onParent
}

/** Sets the rest angle so that the segment points towards the world position. */
export function rotateTo(genome, parts, index, wx, wy, snap) {
  const part = parts[index]
  const pivot = part.anchor ?? { x: part.x, y: part.y }
  let angle = Math.atan2(wy - pivot.y, wx - pivot.x)
  if (index === 0) {
    if (snap) angle = snapTo(angle, Math.PI / 12)
    genome.rootAngle = wrapAngle(angle)
    return
  }
  const parentAngle = parts[genome.segments[index].parent].angle
  let rest = wrapAngle(angle - parentAngle)
  if (snap) rest = snapTo(rest, Math.PI / 12)
  genome.segments[index].joint.rest = clamp(rest, -3.1, 3.1)
}

export function resizeFromPoint(segment, local, axis, snap) {
  const apply = (value) => (snap ? snapTo(value, 0.02) : value)
  if (axis === 'length') {
    const w = apply(Math.abs(local.x) * 2)
    segment.w = clamp(w, segment.shape === 'capsule' ? Math.max(0.1, segment.h) : 0.1, segment.shape === 'circle' ? 0.9 : 1.8)
    if (segment.shape === 'circle') segment.h = segment.w
  } else {
    const h = apply(Math.abs(local.y) * 2)
    segment.h = clamp(h, 0.06, segment.shape === 'capsule' ? Math.min(0.8, segment.w) : 0.8)
  }
}
