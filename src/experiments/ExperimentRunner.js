// Controlled comparisons: one independent variable, several arms, repeated seeds. Each
// arm runs the same seeds, so differences are not down to luck in the founders alone.
import { hashSeed } from '../lib/rng.js'
import { mean, stdev } from '../lib/math.js'
import { makeConfig } from '../evolution/EvolutionEngine.js'
import { EvolutionSession } from '../evolution/EvolutionSession.js'
import { ENVIRONMENTS } from '../physics/Environments.js'
import { OBJECTIVES } from '../evolution/Fitness.js'
import { SELECTION_METHODS } from '../evolution/Selection.js'

export const VARIABLES = [
  {
    id: 'mutationRate', name: 'mutation rate', defaults: ['0.05', '0.2', '0.5'],
    options: ['0.02', '0.05', '0.1', '0.2', '0.35', '0.5', '0.8'].map((value) => ({ value, label: `${Math.round(Number(value) * 100)}%` })),
    apply: (config, value) => ({ mutation: { ...config.mutation, rate: Number(value) } }),
  },
  {
    id: 'populationSize', name: 'population size', defaults: ['10', '30', '60'],
    options: ['6', '10', '20', '30', '60', '100'].map((value) => ({ value, label: `${value} creatures` })),
    apply: (_config, value) => ({ populationSize: Number(value) }),
  },
  {
    id: 'selection', name: 'selection method', defaults: ['tournament', 'rank', 'roulette'],
    options: SELECTION_METHODS.map((method) => ({ value: method.id, label: method.name })),
    apply: (config, value) => ({ selection: { ...config.selection, method: value } }),
  },
  {
    id: 'objective', name: 'fitness function', defaults: ['distance', 'efficient', 'upright'],
    options: OBJECTIVES.map((objective) => ({ value: objective.id, label: objective.name })),
    apply: (_config, value) => ({ objective: value }),
  },
  {
    id: 'controller', name: 'controller type', defaults: ['oscillator', 'neural'],
    options: [{ value: 'oscillator', label: 'oscillators' }, { value: 'neural', label: 'neural network' }],
    apply: (_config, value) => ({ controller: value }),
  },
  {
    id: 'gravity', name: 'gravity', defaults: ['1.62', '9.81', '24.8'],
    options: [['1.62', 'moon, 1.62 m/s²'], ['3.71', 'mars, 3.71 m/s²'], ['9.81', 'earth, 9.81 m/s²'], ['24.8', 'jupiter, 24.8 m/s²']].map(([value, label]) => ({ value, label })),
    apply: (config, value) => ({ env: { ...config.env, gravity: Number(value) } }),
  },
  {
    id: 'terrain', name: 'terrain', defaults: ['flat', 'hills', 'obstacles'],
    options: ENVIRONMENTS.map((env) => ({ value: env.id, label: env.name })),
    apply: (config, value) => ({ env: { ...config.env, id: value } }),
  },
]

export function getVariable(id) {
  return VARIABLES.find((variable) => variable.id === id) ?? VARIABLES[0]
}

export function evaluationsPlanned(setup) {
  const variable = getVariable(setup.variable)
  let total = 0
  for (const value of setup.values) {
    const size = variable.id === 'populationSize' ? Number(value) : setup.populationSize
    total += size * setup.generations * setup.seeds
  }
  return total
}

export function summarizeArm(arm) {
  const finals = arm.runs.map((run) => run.best[run.best.length - 1])
  const generations = Math.max(0, ...arm.runs.map((run) => run.best.length))
  const meanCurve = []
  const lowCurve = []
  const highCurve = []
  for (let g = 0; g < generations; g++) {
    const values = arm.runs.map((run) => run.best[Math.min(g, run.best.length - 1)])
    meanCurve.push(mean(values))
    lowCurve.push(Math.min(...values))
    highCurve.push(Math.max(...values))
  }
  // Convergence: first generation at which a run reached 90% of its own final best.
  const convergence = arm.runs.map((run) => {
    const target = run.best[run.best.length - 1] * 0.9
    const index = run.best.findIndex((value) => value >= target)
    return index < 0 ? run.best.length : index + 1
  })
  return {
    finalMean: mean(finals),
    finalStdev: stdev(finals),
    finalMin: finals.length ? Math.min(...finals) : 0,
    finalMax: finals.length ? Math.max(...finals) : 0,
    convergence: mean(convergence),
    invalidRate: mean(arm.runs.map((run) => run.invalidRate)),
    diversityEnd: mean(arm.runs.map((run) => run.diversity[run.diversity.length - 1] ?? 0)),
    meanCurve,
    lowCurve,
    highCurve,
  }
}

/**
 * Runs the plan. Yields control between generations, so it is cancellable and the UI
 * stays live; the evaluations themselves happen in workers.
 */
export async function runExperimentPlan(setup, ancestor, pool, { onProgress, isCancelled = () => false, register, evaluator } = {}) {
  const variable = getVariable(setup.variable)
  const baseConfig = makeConfig({ ...setup.base, populationSize: setup.populationSize, env: setup.env })
  const arms = setup.values.map((value) => ({ value, label: variable.options.find((option) => option.value === value)?.label ?? value, runs: [], summary: null }))
  const totalGenerations = setup.values.length * setup.seeds * setup.generations
  let doneGenerations = 0
  let evaluations = 0
  for (const arm of arms) {
    for (let s = 0; s < setup.seeds; s++) {
      if (isCancelled()) return { arms, cancelled: true, evaluations }
      const seed = hashSeed(setup.baseSeed, 'seed', s) % 1000000
      const config = makeConfig({ ...baseConfig, ...variable.apply(baseConfig, arm.value), seed })
      const session = new EvolutionSession({ ancestor, config, pool, name: `${arm.label} seed ${s + 1}`, evaluator })
      register?.(session)
      const run = { seed, best: [], mean: [], diversity: [], invalid: 0, total: 0, invalidRate: 0, bestGenome: null, bestFitness: -Infinity }
      try {
        for (let g = 0; g < setup.generations; g++) {
          if (isCancelled()) break
          const record = await session.stepGeneration()
          run.best.push(record.championDistance)
          run.mean.push(record.meanDistance)
          run.diversity.push(record.diversity)
          run.invalid += record.invalid
          run.total += record.populationSize
          evaluations += record.populationSize
          if (record.bestFitness > run.bestFitness) {
            run.bestFitness = record.bestFitness
            run.bestGenome = record.bestGenome
            run.bestMetrics = record.bestMetrics
          }
          doneGenerations++
          onProgress?.({ done: doneGenerations, total: totalGenerations, arm: arm.label, seed: s + 1, generation: g + 1 })
        }
      } finally {
        session.listeners.clear()
      }
      run.invalidRate = run.total ? run.invalid / run.total : 0
      if (run.best.length) arm.runs.push(run)
      arm.summary = arm.runs.length ? summarizeArm(arm) : null
      if (isCancelled()) return { arms, cancelled: true, evaluations }
    }
  }
  return { arms, cancelled: false, evaluations }
}
