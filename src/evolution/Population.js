// Founds a population from one ancestor. The ancestor itself is always included
// unchanged, so generation one includes the starting behaviour as a baseline.
import { cloneGenome, BOUNDS } from '../creatures/Genome.js'
import { repairGenome } from '../creatures/GenomeValidator.js'
import { neuralWeightCount } from '../controllers/NeuralController.js'
import { mutateGenome } from './Mutation.js'

let individualCounter = 0

export function createIndividual(genome, origin, parents = []) {
  individualCounter += 1
  return { id: individualCounter, genome, origin, parents, result: null }
}

/** Replaces the controller with a neural network with small random weights. */
export function toNeural(genome, rng, hidden = 8) {
  const child = cloneGenome(genome)
  child.controller = {
    type: 'neural',
    frequency: rng.range(0.5, 1.6),
    neural: { hidden, weights: [] },
  }
  const count = neuralWeightCount(child, hidden)
  child.controller.neural.weights = Array.from({ length: count }, () => rng.gauss() * 0.6)
  return repairGenome(child)
}

export function toOscillator(genome) {
  const child = cloneGenome(genome)
  child.controller = { type: 'oscillator', frequency: genome.controller.frequency, neural: null }
  return repairGenome(child)
}

/** A fresh attempt at control on the same body: the seeds selection starts from. */
export function randomizeController(genome, rng) {
  const child = cloneGenome(genome)
  child.controller.frequency = rng.range(0.4, 2)
  for (let i = 1; i < child.segments.length; i++) {
    const joint = child.segments[i].joint
    const span = Math.min(joint.upper - joint.lower, BOUNDS.amp[1] * 2)
    joint.osc.amp = rng.range(0.05, 0.45) * span
    joint.osc.phase = rng.range(BOUNDS.phase[0], BOUNDS.phase[1])
    joint.osc.offset = rng.range(-0.2, 0.2) * span
  }
  return repairGenome(child)
}

export function createInitialPopulation(ancestor, config, rng) {
  const size = config.populationSize
  const useNeural = config.controller === 'neural'
  const founder = useNeural && ancestor.controller.type !== 'neural' ? toNeural(ancestor, rng, config.hidden ?? 8) : !useNeural && ancestor.controller.type === 'neural' ? toOscillator(ancestor) : cloneGenome(ancestor)
  const population = [createIndividual(founder, 'founder')]
  while (population.length < size) {
    const genome = useNeural
      ? toNeural(ancestor, rng, config.hidden ?? 8)
      : population.length % 3 === 0
        ? mutateGenome(founder, { ...config.mutation, rate: 0.5, strength: 0.2 }, rng)
        : randomizeController(founder, rng)
    population.push(createIndividual(genome, 'founder'))
  }
  return population
}
