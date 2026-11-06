import { repairGenome } from '../../src/creatures/GenomeValidator.js'
import { evaluateGenome } from '../../src/evolution/evaluate.js'

export const FLAT = { id: 'flat', seed: 7 }

/** A single body with one motorised limb, for controlled physics tests. */
export function simpleCreature(overrides = {}) {
  return repairGenome({
    schema: 1,
    name: 'test',
    rootAngle: 0,
    controller: { type: 'oscillator', frequency: 1, neural: null },
    segments: [
      { id: 's0', shape: 'box', w: 0.8, h: 0.3, density: 10, friction: 0.9, restitution: 0, color: '#888888', parent: null, joint: null },
      {
        id: 's1', shape: 'capsule', w: 0.5, h: 0.1, density: 10, friction: 0.9, restitution: 0, color: '#888888', parent: 0,
        joint: {
          anchorParent: { u: 0.9, v: 0 }, anchorChild: { u: -0.9, v: 0 }, rest: 0, lower: -1, upper: 1, maxTorque: 30, maxSpeed: 8, damping: 0, gain: 8,
          osc: { amp: 0, phase: 0, offset: 0, harmonic: 1, dir: 1 },
        },
        ...overrides,
      },
    ],
  })
}

/** Synchronous evaluator matching the session's injection point. */
export function syncEvaluator(population, config, { onProgress } = {}) {
  const pending = population.filter((individual) => !individual.result)
  pending.forEach((individual, i) => {
    individual.result = evaluateGenome(individual.genome, config.env, { duration: config.duration, trials: config.trials, objective: config.objective, weights: config.weights })
    onProgress?.(i + 1, pending.length)
  })
  return Promise.resolve({ failures: 0 })
}
