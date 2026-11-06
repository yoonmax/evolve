// Evaluates a genome: the function workers call. Pure and deterministic, given the genome,
// the environment and the run length.
import { simulateCreature } from '../physics/SimulationStepper.js'
import { computeFitness } from './Fitness.js'

const AVERAGED = ['distance', 'furthest', 'avgSpeed', 'bestSpeed', 'energy', 'energyNorm', 'upright', 'contact', 'bodyDrag', 'airTime', 'peakHeight', 'jointTravel', 'falls', 'recoveries', 'elapsed', 'peakJointError']

/**
 * @param sim {duration, trials, objective, weights}
 * Trials above one average over deterministically varied terrain seeds, which rewards
 * gaits that generalise. Elites keep identical scores because the seeds are identical.
 */
export function evaluateGenome(genome, envConfig, sim = {}) {
  const trials = Math.max(1, sim.trials ?? 1)
  const runs = []
  for (let i = 0; i < trials; i++) {
    const env = { ...envConfig, seed: (envConfig.seed ?? 0) + i * 101 }
    const { metrics } = simulateCreature(genome, env, { duration: sim.duration ?? 12 })
    runs.push(metrics)
    if (metrics.invalid) break
  }
  const metrics = { ...runs[0] }
  if (runs.length > 1) {
    for (const key of AVERAGED) metrics[key] = runs.reduce((sum, run) => sum + run[key], 0) / runs.length
    metrics.invalid = runs.find((run) => run.invalid)?.invalid ?? null
    metrics.stateHash = runs.map((run) => run.stateHash).join('.')
  }
  return { fitness: computeFitness(metrics, sim.objective, sim.weights), metrics }
}
