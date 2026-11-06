import { describe, expect, it } from 'vitest'
import { breedNextGeneration, makeConfig, rankPopulation } from '../../src/evolution/EvolutionEngine.js'
import { computeFitness, DEFAULT_WEIGHTS, OBJECTIVES } from '../../src/evolution/Fitness.js'
import { rankProbabilities, rankSelect, rouletteProbabilities, rouletteSelect, tournamentSelect, selectParent } from '../../src/evolution/Selection.js'
import { areCompatible, crossover } from '../../src/evolution/Crossover.js'
import { createIndividual, createInitialPopulation, toNeural } from '../../src/evolution/Population.js'
import { EvolutionSession } from '../../src/evolution/EvolutionSession.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { validateGenome } from '../../src/creatures/GenomeValidator.js'
import { Rng } from '../../src/lib/rng.js'
import { evaluateGenome } from '../../src/evolution/evaluate.js'
import { generationStats } from '../../src/statistics/StatisticsEngine.js'
import { FLAT, syncEvaluator } from './helpers.js'

function scored(count) {
  const genome = createPresets()[0]
  return Array.from({ length: count }, (_, i) => {
    const individual = createIndividual(genome, 'founder')
    individual.result = { fitness: count - i, metrics: { distance: count - i, energyNorm: 1, invalid: null } }
    return individual
  })
}

const baseMetrics = { distance: 10, upright: 1, energyNorm: 10, bestSpeed: 1, peakHeight: 0.2, bodyDrag: 0, invalid: null }

describe('fitness', () => {
  it('rewards measured forward distance', () => {
    expect(computeFitness({ ...baseMetrics, distance: 20 })).toBeGreaterThan(computeFitness(baseMetrics))
  })

  it('computes the documented formula', () => {
    const w = DEFAULT_WEIGHTS
    expect(computeFitness(baseMetrics)).toBeCloseTo(w.distance * 10 + w.upright * 1 - w.energy * 10, 9)
  })

  it('charges for energy and for dragging the body', () => {
    expect(computeFitness({ ...baseMetrics, energyNorm: 500 })).toBeLessThan(computeFitness(baseMetrics))
    expect(computeFitness({ ...baseMetrics, bodyDrag: 1 })).toBeLessThan(computeFitness(baseMetrics) - 5)
  })

  it('penalises invalid runs below any valid one, even with high distance', () => {
    const invalid = computeFitness({ ...baseMetrics, distance: 500, invalid: 'joint came apart' })
    expect(invalid).toBeLessThan(0)
    expect(invalid).toBeLessThan(computeFitness({ ...baseMetrics, distance: -5 }))
  })

  it('does not discount backward motion for dragging', () => {
    const back = { ...baseMetrics, distance: -4, bodyDrag: 1, upright: 0, energyNorm: 0 }
    expect(computeFitness(back)).toBeCloseTo(-4, 9)
  })

  it('offers objectives that really rank creatures differently', () => {
    const efficient = { ...baseMetrics, distance: 6, energyNorm: 2 }
    const wasteful = { ...baseMetrics, distance: 9, energyNorm: 200 }
    expect(computeFitness(wasteful, 'distance')).toBeGreaterThan(computeFitness(efficient, 'distance'))
    expect(computeFitness(efficient, 'efficient')).toBeGreaterThan(computeFitness(wasteful, 'efficient'))
    const jumper = { ...baseMetrics, distance: 1, peakHeight: 2 }
    expect(computeFitness(jumper, 'jump')).toBeGreaterThan(computeFitness(baseMetrics, 'jump'))
    expect(OBJECTIVES.length).toBeGreaterThanOrEqual(4)
  })
})

describe('reward hacking', () => {
  // The genomes here are built to cheat. Each test states the exploit and shows it does not pay.
  it('high-frequency vibration does not beat a modest gait', () => {
    const genome = createPresets()[1]
    const vibrator = JSON.parse(JSON.stringify(genome))
    vibrator.controller.frequency = 3
    for (const segment of vibrator.segments.slice(1)) {
      segment.joint.osc.harmonic = 2
      segment.joint.osc.amp = 0.08
      segment.joint.maxTorque = 120
      segment.joint.gain = 24
    }
    const { metrics, fitness } = evaluateGenome(vibrator, FLAT, { duration: 12 })
    expect(metrics.bestSpeed).toBeLessThan(3)
    expect(fitness).toBeLessThan(25)
  })

  it('toppling over earns at most a body length of credit', () => {
    const tower = JSON.parse(JSON.stringify(createPresets()[0]))
    tower.segments[0].w = 1.8
    tower.segments[0].density = 40
    for (const segment of tower.segments.slice(1)) {
      segment.joint.osc.amp = 0
      segment.joint.maxTorque = 1
    }
    const { metrics } = evaluateGenome(tower, FLAT, { duration: 12 })
    expect(metrics.distance).toBeLessThan(2.5)
  })

  it('cannot gain from breaking the speed limit', () => {
    const invalid = computeFitness({ ...baseMetrics, distance: 300, invalid: 'body exceeded the speed limit' })
    expect(invalid).toBeLessThan(-DEFAULT_WEIGHTS.invalid + 1)
  })

  it('caps physically implausible launches with the solver watchdog', () => {
    const genome = createPresets()[2]
    const launcher = JSON.parse(JSON.stringify(genome))
    for (const segment of launcher.segments) {
      segment.density = 2
      if (segment.joint) {
        segment.joint.maxTorque = 120
        segment.joint.maxSpeed = 16
        segment.joint.gain = 24
        segment.joint.osc.amp = 1.6
      }
    }
    launcher.controller.frequency = 3
    const { metrics } = evaluateGenome(launcher, FLAT, { duration: 12 })
    const worstPossible = 30 * 12 // the speed limit applied for the whole run
    expect(Math.abs(metrics.distance)).toBeLessThan(worstPossible)
    expect(Number.isFinite(metrics.energy)).toBe(true)
  })
})

describe('selection', () => {
  const ranked = scored(10)

  it('tournament favours the fit, more so as the tournament grows', () => {
    const rng = new Rng(1)
    const meanRank = (size) => {
      let sum = 0
      for (let i = 0; i < 4000; i++) sum += ranked.indexOf(tournamentSelect(ranked, rng, size))
      return sum / 4000
    }
    const small = meanRank(2)
    const large = meanRank(6)
    expect(small).toBeLessThan(4.5)
    expect(large).toBeLessThan(small)
  })

  it('rank probabilities sum to one and fall with rank', () => {
    const p = rankProbabilities(10, 1.8)
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(p[0]).toBeCloseTo(1.8 / 10, 9)
    expect(p[9]).toBeCloseTo(0.2 / 10, 9)
    for (let i = 1; i < 10; i++) expect(p[i]).toBeLessThan(p[i - 1])
  })

  it('rank selection matches its probabilities', () => {
    const rng = new Rng(2)
    const counts = new Array(10).fill(0)
    const samples = 30000
    for (let i = 0; i < samples; i++) counts[ranked.indexOf(rankSelect(ranked, rng, 1.8))]++
    const p = rankProbabilities(10, 1.8)
    counts.forEach((count, i) => expect(count / samples).toBeCloseTo(p[i], 1))
  })

  it('roulette follows fitness proportions, with a floor for the worst', () => {
    const p = rouletteProbabilities(ranked)
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(p[0]).toBeGreaterThan(p[9])
    expect(p[9]).toBeGreaterThan(0)
    const rng = new Rng(4)
    let first = 0
    for (let i = 0; i < 5000; i++) if (rouletteSelect(ranked, rng) === ranked[0]) first++
    expect(first / 5000).toBeCloseTo(p[0], 1)
  })

  it('dispatches on the configured method', () => {
    const rng = new Rng(5)
    for (const method of ['tournament', 'rank', 'roulette']) {
      expect(ranked).toContain(selectParent(ranked, rng, { method }))
    }
  })
})

describe('crossover', () => {
  it('recombines compatible parents gene-block by gene-block', () => {
    const rng = new Rng(3)
    const genome = createPresets()[0]
    const a = JSON.parse(JSON.stringify(genome))
    const b = JSON.parse(JSON.stringify(genome))
    a.segments.slice(1).forEach((segment) => { segment.joint.osc.amp = 0.1 })
    b.segments.slice(1).forEach((segment) => { segment.joint.osc.amp = 0.9 })
    const child = crossover(a, b, rng)
    const amps = child.segments.slice(1).map((segment) => segment.joint.osc.amp)
    expect(amps.every((amp) => amp === 0.1 || amp === 0.9)).toBe(true)
    expect(new Set(amps).size).toBe(2)
    expect(validateGenome(child)).toEqual([])
  })

  it('refuses incompatible body graphs', () => {
    const [a, b] = createPresets()
    expect(areCompatible(a, b)).toBe(false)
    expect(crossover(a, b, new Rng(1))).toBeNull()
  })

  it('does not mix oscillator and neural parents', () => {
    const genome = createPresets()[0]
    expect(crossover(genome, toNeural(genome, new Rng(2)), new Rng(1))).toBeNull()
  })

  it('recombines neural weights from both parents', () => {
    const rng = new Rng(6)
    const genome = createPresets()[0]
    const a = toNeural(genome, rng, 6)
    const b = toNeural(genome, rng, 6)
    let mixed = 0
    for (let i = 0; i < 20; i++) {
      const child = crossover(a, b, rng)
      const weights = child.controller.neural.weights
      expect(weights.length).toBe(a.controller.neural.weights.length)
      if (weights.some((w, j) => w === a.controller.neural.weights[j]) && weights.some((w, j) => w === b.controller.neural.weights[j])) mixed++
    }
    expect(mixed).toBeGreaterThan(5)
  })
})

describe('generation step', () => {
  const config = makeConfig({ seed: 8, populationSize: 12, elites: 2, duration: 2 })

  function evaluated() {
    const population = createInitialPopulation(createPresets()[1], config, new Rng(1))
    population.forEach((individual, i) => {
      individual.result = { fitness: i, metrics: { distance: i, energyNorm: 0, invalid: null } }
    })
    return population
  }

  it('keeps the population size', () => {
    expect(breedNextGeneration(evaluated(), config, 1).population.length).toBe(12)
  })

  it('copies elites exactly, with their measured result, and mutates no one else into them', () => {
    const population = evaluated()
    const ranked = rankPopulation(population)
    const { population: next } = breedNextGeneration(population, config, 1)
    expect(next[0].origin).toBe('elite')
    expect(next[1].origin).toBe('elite')
    expect(next[0].genome).toEqual(ranked[0].genome)
    expect(next[1].genome).toEqual(ranked[1].genome)
    expect(next[0].result).toBe(ranked[0].result)
    expect(next[0].genome).not.toBe(ranked[0].genome)
    for (const child of next.slice(2)) expect(child.result).toBeNull()
  })

  it('ranks stably on ties', () => {
    const population = evaluated()
    population.forEach((individual) => { individual.result.fitness = 1 })
    expect(rankPopulation(population).map((individual) => individual.id)).toEqual(population.map((individual) => individual.id))
  })
})

describe('sessions', () => {
  const ancestor = createPresets()[1]
  const config = { seed: 21, populationSize: 8, duration: 2, env: FLAT }
  const make = () => new EvolutionSession({ ancestor, config, evaluator: syncEvaluator })

  it('advances one generation at a time and records real results', async () => {
    const session = make()
    const record = await session.stepGeneration()
    expect(record.generation).toBe(1)
    expect(session.generation).toBe(2)
    expect(session.history.length).toBe(1)
    expect(record.fitness.length).toBe(8)
    expect(record.bestFitness).toBe(Math.max(...record.fitness))
    expect(record.bestGenome.segments.length).toBe(ancestor.segments.length)
  })

  it('is exactly reproducible from its seed', async () => {
    const a = make()
    const b = make()
    for (let i = 0; i < 4; i++) {
      await a.stepGeneration()
      await b.stepGeneration()
    }
    expect(a.history.map((r) => r.fitness)).toEqual(b.history.map((r) => r.fitness))
    expect(a.history[3].bestGenome).toEqual(b.history[3].bestGenome)
  })

  it('does not depend on the order evaluations finish in', async () => {
    const reversed = (population, cfg, options) => {
      const pending = population.filter((individual) => !individual.result)
      for (const individual of [...pending].reverse()) {
        individual.result = evaluateGenome(individual.genome, cfg.env, { duration: cfg.duration, objective: cfg.objective })
      }
      options?.onProgress?.(pending.length, pending.length)
      return Promise.resolve({ failures: 0 })
    }
    const a = make()
    const b = new EvolutionSession({ ancestor, config, evaluator: reversed })
    for (let i = 0; i < 3; i++) {
      await a.stepGeneration()
      await b.stepGeneration()
    }
    expect(a.history[2].fitness).toEqual(b.history[2].fitness)
  })

  it('differs under a different seed', async () => {
    const a = make()
    const b = new EvolutionSession({ ancestor, config: { ...config, seed: 22 }, evaluator: syncEvaluator })
    await a.stepGeneration()
    await b.stepGeneration()
    expect(a.history[0].fitness).not.toEqual(b.history[0].fitness)
  })

  it('never lets the elite\'s score go down while settings are unchanged', async () => {
    const session = make()
    for (let i = 0; i < 6; i++) await session.stepGeneration()
    const best = session.history.map((record) => record.bestFitness)
    for (let i = 1; i < best.length; i++) expect(best[i]).toBeGreaterThanOrEqual(best[i - 1])
  })

  it('resuming from a checkpoint continues exactly as if it had never stopped', async () => {
    const straight = make()
    for (let i = 0; i < 5; i++) await straight.stepGeneration()

    const first = make()
    for (let i = 0; i < 3; i++) await first.stepGeneration()
    const stored = JSON.parse(JSON.stringify(first.toCheckpoint()))
    const resumed = EvolutionSession.fromCheckpoint(stored, first.history, { evaluator: syncEvaluator })
    await resumed.stepGeneration()
    await resumed.stepGeneration()
    expect(resumed.history[4].fitness).toEqual(straight.history[4].fitness)
    expect(resumed.history[4].bestGenome).toEqual(straight.history[4].bestGenome)
  })

  it('re-tests elites when the environment changes', async () => {
    const session = make()
    await session.stepGeneration()
    expect(session.population.some((individual) => individual.result)).toBe(true)
    session.updateConfig({ env: { id: 'ice', seed: 7 } })
    expect(session.population.every((individual) => individual.result === null)).toBe(true)
  })

  it('resizes the population', async () => {
    const session = make()
    session.updateConfig({ populationSize: 20 })
    const record = await session.stepGeneration()
    expect(record.populationSize).toBe(20)
    session.updateConfig({ populationSize: 6 })
    expect(session.population.length).toBe(6)
  })

  it('run() stops on request and honours a generation limit', async () => {
    const session = make()
    await session.run({ limit: 3 })
    expect(session.history.length).toBe(3)
    const other = make()
    other.gate = async () => { other.stop() }
    await other.run()
    expect(other.history.length).toBe(1)
  })

  it('branches into a new experiment from a saved champion', async () => {
    const session = make()
    await session.stepGeneration()
    const branch = session.branchFrom(session.history[0])
    expect(branch.id).not.toBe(session.id)
    expect(branch.population[0].genome).toEqual(session.history[0].bestGenome)
    expect(branch.config.seed).not.toBe(session.config.seed)
  })

  it('reports worker failures without ending the experiment', async () => {
    const failing = (population) => {
      for (const individual of population) individual.result = { fitness: -1000, metrics: { distance: 0, energyNorm: 0, invalid: 'worker failed' } }
      return Promise.resolve({ failures: population.length })
    }
    const session = new EvolutionSession({ ancestor, config, evaluator: failing })
    const record = await session.stepGeneration()
    expect(record.failures).toBe(8)
    expect(record.invalid).toBe(8)
    expect(session.generation).toBe(2)
  })
})

describe('selection pressure produces locomotion', () => {
  it('improves on the founder over real physics, for oscillators', async () => {
    const ancestor = createPresets()[0]
    const config = { seed: 3, populationSize: 16, duration: 6, env: FLAT }
    const session = new EvolutionSession({ ancestor, config, evaluator: syncEvaluator })
    const founder = evaluateGenome(ancestor, FLAT, { duration: 6 })
    for (let i = 0; i < 15; i++) await session.stepGeneration()
    const last = session.history[session.history.length - 1]
    expect(last.bestFitness).toBeGreaterThan(founder.fitness + 3)
    expect(last.championDistance).toBeGreaterThan(founder.metrics.distance + 3)
  }, 120000)

  it('improves on the founder over real physics, for neural controllers', async () => {
    const ancestor = createPresets()[1]
    const config = { seed: 4, populationSize: 16, duration: 6, env: FLAT, controller: 'neural', hidden: 6 }
    const session = new EvolutionSession({ ancestor, config, evaluator: syncEvaluator })
    for (let i = 0; i < 15; i++) await session.stepGeneration()
    const first = session.history[0]
    const last = session.history[session.history.length - 1]
    expect(last.bestFitness).toBeGreaterThan(first.bestFitness + 0.5)
    expect(last.bestGenome.controller.type).toBe('neural')
  }, 120000)

  it('beats random search for the same evaluation budget', async () => {
    const ancestor = createPresets()[3]
    const config = { seed: 5, populationSize: 12, duration: 5, env: FLAT }
    const session = new EvolutionSession({ ancestor, config, evaluator: syncEvaluator })
    for (let i = 0; i < 12; i++) await session.stepGeneration()
    const evolved = session.history[session.history.length - 1].bestFitness
    // random search: the same number of independent founders, never bred
    const founders = createInitialPopulation(ancestor, { ...makeConfig(config), populationSize: 144 }, new Rng(77))
    let bestRandom = -Infinity
    for (const individual of founders) bestRandom = Math.max(bestRandom, evaluateGenome(individual.genome, FLAT, { duration: 5 }).fitness)
    expect(evolved).toBeGreaterThan(bestRandom)
  }, 120000)
})

describe('statistics', () => {
  it('derives aggregates from the scores', () => {
    const ranked = scored(5)
    const stats = generationStats(ranked, 3, 2)
    expect(stats.generation).toBe(3)
    expect(stats.bestFitness).toBe(5)
    expect(stats.worstFitness).toBe(1)
    expect(stats.meanFitness).toBe(3)
    expect(stats.medianFitness).toBe(3)
    expect(stats.bestDistance).toBe(5)
    expect(stats.survivalRate).toBeCloseTo(0.4, 9)
    expect(stats.diversity).toBeCloseTo(0, 9)
  })
})
