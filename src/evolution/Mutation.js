// Mutation operators. All of them stay inside the genome's bounds; repairGenome at the
// end guarantees the result can be decoded whatever combination of changes occurred.
import { BOUNDS, HARMONICS, cloneGenome, listGenes, setGene } from '../creatures/Genome.js'
import { repairGenome } from '../creatures/GenomeValidator.js'
import { MAX_SEGMENTS } from '../physics/constants.js'

export const DEFAULT_MUTATION = Object.freeze({
  rate: 0.2, // chance that any given gene changes
  strength: 0.1, // Gaussian sigma, as a fraction of the gene's range
  resetRate: 0.01, // chance that a chosen gene is redrawn uniformly instead
  bodyRate: 0.25, // relative rate for body and motor genes; 0 freezes the body plan
  structuralRate: 0, // chance per offspring of adding or removing a limb
})

function perturb(gene, config, rng) {
  const current = gene.holder[gene.field]
  if (rng.bool(config.resetRate)) {
    setGene(gene, rng.range(gene.min, gene.max))
    return
  }
  setGene(gene, current + rng.gauss() * config.strength * (gene.max - gene.min))
}

export function mutateGenome(genome, mutation = DEFAULT_MUTATION, rng) {
  const config = { ...DEFAULT_MUTATION, ...mutation }
  let child = cloneGenome(genome)
  let changed = 0
  const genes = listGenes(child)
  for (const gene of genes) {
    const isBody = gene.group === 'body' || gene.group === 'motor'
    const rate = config.rate * (isBody ? config.bodyRate : 1)
    if (rate > 0 && rng.bool(rate)) {
      perturb(gene, config, rng)
      changed++
    }
  }
  // Discrete gait genes: rhythm ratio and direction change rarely but matter a lot.
  for (let i = 1; i < child.segments.length; i++) {
    const osc = child.segments[i].joint.osc
    if (rng.bool(config.rate * 0.1)) {
      osc.harmonic = rng.pick(HARMONICS)
      changed++
    }
    if (rng.bool(config.rate * 0.05)) {
      osc.dir = -osc.dir
      changed++
    }
  }
  if (config.structuralRate > 0 && child.controller.type === 'oscillator' && rng.bool(config.structuralRate)) {
    child = structuralMutation(child, rng)
    changed++
  }
  if (changed === 0 && genes.length) {
    // No offspring should be a silent clone: elites are the only exact copies.
    const controllerGenes = genes.filter((gene) => gene.group === 'oscillator' || gene.group === 'neural')
    perturb(rng.pick(controllerGenes.length ? controllerGenes : genes), config, rng)
  }
  return repairGenome(child)
}

/** Adds a small limb or removes a leaf. Structure stays a rooted tree by construction. */
export function structuralMutation(genome, rng) {
  const child = cloneGenome(genome)
  const count = child.segments.length
  const hasChild = new Array(count).fill(false)
  child.segments.forEach((segment) => {
    if (segment.parent !== null) hasChild[segment.parent] = true
  })
  const leaves = hasChild.flatMap((value, index) => (!value && index > 0 ? [index] : []))
  const remove = leaves.length > 1 && (count >= MAX_SEGMENTS || rng.bool(0.4))
  if (remove) {
    const victim = rng.pick(leaves)
    child.segments.splice(victim, 1)
    child.segments.forEach((segment, index) => {
      if (segment.parent !== null && segment.parent > victim) segment.parent -= 1
      segment.id = `s${index}`
    })
    return child
  }
  if (count >= MAX_SEGMENTS) return child
  const parent = rng.int(count)
  const source = child.segments[parent]
  child.segments.push({
    id: `s${count}`,
    shape: 'capsule',
    w: rng.range(0.2, 0.55),
    h: rng.range(0.08, 0.16),
    density: rng.range(8, 16),
    friction: 0.9,
    restitution: 0.05,
    color: source.color,
    parent,
    joint: {
      anchorParent: { u: rng.range(-0.9, 0.9), v: rng.pick([-0.9, 0.9]) },
      anchorChild: { u: -0.85, v: 0 },
      rest: rng.range(-2.4, 2.4),
      lower: rng.range(-1.2, -0.3),
      upper: rng.range(0.3, 1.2),
      maxTorque: rng.range(10, 40),
      maxSpeed: rng.range(5, 10),
      damping: 0.2,
      gain: 8,
      osc: { amp: rng.range(0.1, 0.5), phase: rng.range(BOUNDS.phase[0], BOUNDS.phase[1]), offset: 0, harmonic: rng.pick(HARMONICS), dir: 1 },
    },
  })
  return child
}
