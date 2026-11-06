// Recombination for genomes with identical body graphs. Genes that act together stay
// together: a joint's limits and oscillator come from one parent as a block, because
// mixing half of one gait with half of another almost always produces neither.
import { cloneGenome, topologySignature } from '../creatures/Genome.js'
import { repairGenome } from '../creatures/GenomeValidator.js'

export function areCompatible(a, b) {
  return topologySignature(a) === topologySignature(b)
}

/** Returns a child, or null when the parents cannot recombine safely. */
export function crossover(a, b, rng) {
  if (!areCompatible(a, b)) return null
  const child = cloneGenome(a)
  for (let i = 0; i < child.segments.length; i++) {
    if (!rng.bool(0.5)) continue
    const source = b.segments[i]
    const target = child.segments[i]
    target.w = source.w
    target.h = source.h
    target.density = source.density
    target.friction = source.friction
    target.restitution = source.restitution
    if (source.joint) target.joint = JSON.parse(JSON.stringify(source.joint))
  }
  const blend = rng.next()
  child.controller.frequency = a.controller.frequency * blend + b.controller.frequency * (1 - blend)
  if (child.controller.type === 'neural') {
    // Crossing at a hidden-unit boundary keeps each unit's incoming weights intact.
    const hidden = child.controller.neural.hidden
    const weightsA = a.controller.neural.weights
    const weightsB = b.controller.neural.weights
    const stride = Math.floor((weightsA.length - child.segments.length * 0) / (hidden + 1)) || 1
    const cut = rng.int(hidden + 1) * stride
    child.controller.neural.weights = weightsA.map((value, i) => (i < cut ? value : weightsB[i]))
  }
  return repairGenome(child)
}
