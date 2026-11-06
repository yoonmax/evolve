// The genome is the inherited description of an organism: plain, serialisable data with
// bounded parameters. Keep the layers apart:
//   genome → (GenomeDecoder) → phenotype → (CreatureBody) → physics instance → (Fitness) → result
import { clamp, wrapAngle } from '../lib/math.js'
import { hashSeed } from '../lib/rng.js'

export const SCHEMA_VERSION = 1

export const SHAPES = ['capsule', 'circle', 'box']
export const HARMONICS = [0.5, 1, 2]

/** Physically meaningful ranges for every gene. Mutation and repair both respect these. */
export const BOUNDS = {
  w: [0.1, 1.8],
  h: [0.06, 0.8],
  density: [2, 40],
  friction: [0.1, 1.5],
  restitution: [0, 0.6],
  anchor: [-1, 1],
  rest: [-3.1, 3.1],
  lower: [-2.6, 0],
  upper: [0, 2.6],
  maxTorque: [1, 120],
  maxSpeed: [1, 16],
  damping: [0, 4],
  gain: [1, 24],
  amp: [0, 1.6],
  phase: [-Math.PI, Math.PI],
  offset: [-1.2, 1.2],
  frequency: [0.15, 3],
  weight: [-4, 4],
  hidden: [4, 16],
}

export const DEFAULT_SEGMENT = Object.freeze({ shape: 'capsule', w: 0.5, h: 0.14, density: 12, friction: 0.9, restitution: 0.05 })

export const DEFAULT_JOINT = Object.freeze({
  rest: 0,
  lower: -1,
  upper: 1,
  maxTorque: 30,
  maxSpeed: 8,
  damping: 0.2,
  gain: 8,
})

export const DEFAULT_OSC = Object.freeze({ amp: 0.25, phase: 0, offset: 0, harmonic: 1, dir: 1 })

export function cloneGenome(genome) {
  return structuredCloneSafe(genome)
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Enumerates every mutable numeric gene with its bounds and accessors. Mutation, the
 * diversity proxy and the comparison view all read the genome through this one list.
 */
export function listGenes(genome) {
  const genes = []
  const add = (key, group, holder, field, bounds, options = {}) => {
    genes.push({ key, group, holder, field, min: bounds[0], max: bounds[1], ...options })
  }
  genome.segments.forEach((segment, index) => {
    const id = `s${index}`
    add(`${id}.w`, 'body', segment, 'w', BOUNDS.w)
    if (segment.shape !== 'circle') add(`${id}.h`, 'body', segment, 'h', BOUNDS.h)
    add(`${id}.density`, 'body', segment, 'density', BOUNDS.density)
    add(`${id}.friction`, 'body', segment, 'friction', BOUNDS.friction)
    const joint = segment.joint
    if (!joint) return
    add(`${id}.anchorP.u`, 'body', joint.anchorParent, 'u', BOUNDS.anchor)
    add(`${id}.anchorP.v`, 'body', joint.anchorParent, 'v', BOUNDS.anchor)
    add(`${id}.rest`, 'body', joint, 'rest', BOUNDS.rest)
    add(`${id}.lower`, 'motor', joint, 'lower', BOUNDS.lower)
    add(`${id}.upper`, 'motor', joint, 'upper', BOUNDS.upper)
    add(`${id}.maxTorque`, 'motor', joint, 'maxTorque', BOUNDS.maxTorque)
    add(`${id}.maxSpeed`, 'motor', joint, 'maxSpeed', BOUNDS.maxSpeed)
    add(`${id}.gain`, 'motor', joint, 'gain', BOUNDS.gain)
    const osc = joint.osc
    add(`${id}.amp`, 'oscillator', osc, 'amp', BOUNDS.amp)
    add(`${id}.phase`, 'oscillator', osc, 'phase', BOUNDS.phase, { wrap: true })
    add(`${id}.offset`, 'oscillator', osc, 'offset', BOUNDS.offset)
  })
  add('frequency', 'oscillator', genome.controller, 'frequency', BOUNDS.frequency)
  if (genome.controller.type === 'neural' && genome.controller.neural) {
    const weights = genome.controller.neural.weights
    for (let i = 0; i < weights.length; i++) add(`w${i}`, 'neural', weights, i, BOUNDS.weight)
  }
  return genes
}

/** Sets a gene, respecting its bounds. */
export function setGene(gene, value) {
  gene.holder[gene.field] = gene.wrap ? wrapAngle(value) : clamp(value, gene.min, gene.max)
}

/** Two genomes can recombine gene-for-gene only when their body graphs match. */
export function topologySignature(genome) {
  const nodes = genome.segments.map((segment) => `${segment.parent ?? '-'}${segment.shape[0]}`).join(',')
  const neural = genome.controller.type === 'neural' ? `|n${genome.controller.neural?.weights.length ?? 0}` : ''
  return `${genome.controller.type}|${nodes}${neural}`
}

/** A short, stable fingerprint, used to label replays and to check them. */
export function genomeHash(genome) {
  const { name: _name, lineage: _lineage, tagline: _tagline, ...physical } = genome
  const stripped = {
    ...physical,
    segments: genome.segments.map(({ color: _color, id: _id, ...rest }) => rest),
  }
  return hashSeed(JSON.stringify(stripped)).toString(36)
}

export function countJoints(genome) {
  return genome.segments.length - 1
}
