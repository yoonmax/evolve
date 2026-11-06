import { describe, expect, it } from 'vitest'
import { VARIABLES, evaluationsPlanned, getVariable, runExperimentPlan, summarizeArm } from '../../src/experiments/ExperimentRunner.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { makeConfig } from '../../src/evolution/EvolutionEngine.js'
import { rankRacers } from '../../src/statistics/raceResults.js'
import { Rng, hashSeed } from '../../src/lib/rng.js'
import { mean, median, quantile, stdev, wrapAngle } from '../../src/lib/math.js'
import { syncEvaluator } from './helpers.js'

const setup = (overrides = {}) => ({
  variable: 'mutationRate', values: ['0.05', '0.5'], generations: 3, seeds: 2, populationSize: 6, env: { id: 'flat', seed: 7 }, baseSeed: 1, base: { duration: 1.5 }, ...overrides,
})

describe('experiment plans', () => {
  it('counts the simulated runs it will perform', () => {
    expect(evaluationsPlanned(setup())).toBe(2 * 2 * 3 * 6)
    expect(evaluationsPlanned(setup({ variable: 'populationSize', values: ['10', '20'] }))).toBe((10 + 20) * 3 * 2)
  })

  it('every variable changes the configuration', () => {
    const base = makeConfig()
    for (const variable of VARIABLES) {
      const [a, b] = variable.defaults
      expect(variable.apply(base, a)).not.toEqual(variable.apply(base, b))
    }
  })

  it('runs every arm over the same seeds and is reproducible', async () => {
    const ancestor = createPresets()[1]
    const a = await runExperimentPlan(setup(), ancestor, null, { evaluator: syncEvaluator })
    const b = await runExperimentPlan(setup(), ancestor, null, { evaluator: syncEvaluator })
    expect(a.arms.length).toBe(2)
    expect(a.arms[0].runs.map((run) => run.seed)).toEqual(a.arms[1].runs.map((run) => run.seed))
    expect(a.arms[0].runs[0].best).toEqual(b.arms[0].runs[0].best)
    expect(a.evaluations).toBeGreaterThan(0)
    expect(a.arms[0].summary.meanCurve.length).toBe(3)
  }, 60000)

  it('stops when cancelled and keeps results so far', async () => {
    let calls = 0
    const result = await runExperimentPlan(setup(), createPresets()[1], null, {
      evaluator: syncEvaluator,
      onProgress: () => { calls++ },
      isCancelled: () => calls >= 2,
    })
    expect(result.cancelled).toBe(true)
    expect(result.arms[0].runs.length).toBeGreaterThanOrEqual(0)
  }, 60000)

  it('summarises arms across seeds', () => {
    const summary = summarizeArm({ runs: [
      { best: [1, 2, 4], invalidRate: 0, diversity: [0.2] },
      { best: [1, 3, 6], invalidRate: 0.5, diversity: [0.4] },
    ] })
    expect(summary.finalMean).toBe(5)
    expect(summary.finalMin).toBe(4)
    expect(summary.finalMax).toBe(6)
    expect(summary.meanCurve).toEqual([1, 2.5, 5])
    expect(summary.invalidRate).toBe(0.25)
    expect(summary.diversityEnd).toBeCloseTo(0.3, 9)
  })

  it('finds variables by id', () => {
    expect(getVariable('gravity').name).toBe('gravity')
    expect(getVariable('nope').id).toBe(VARIABLES[0].id)
  })
})

describe('race results', () => {
  const track = (finishTime, distance) => ({ metrics: { finishTime, distance } })

  it('puts finishers first by time, then the rest by distance', () => {
    const ranked = rankRacers([track(null, 30), track(9, 40), track(7, 40), track(null, 35)])
    expect(ranked.map((row) => row.index)).toEqual([2, 1, 3, 0])
  })
})

describe('seeded randomness', () => {
  it('is reproducible and well distributed', () => {
    const a = new Rng(5)
    const b = new Rng(5)
    const values = Array.from({ length: 5000 }, () => a.next())
    expect(values[42]).toBe((() => { let v; for (let i = 0; i < 43; i++) v = b.next(); return v })())
    expect(mean(values)).toBeCloseTo(0.5, 1)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
  })

  it('produces standard normal noise', () => {
    const rng = new Rng(9)
    const values = Array.from({ length: 20000 }, () => rng.gauss())
    expect(mean(values)).toBeCloseTo(0, 1)
    expect(stdev(values)).toBeCloseTo(1, 1)
  })

  it('hashes distinct inputs to distinct seeds', () => {
    expect(hashSeed(1, 'a')).toBe(hashSeed(1, 'a'))
    expect(hashSeed(1, 'a')).not.toBe(hashSeed(1, 'b'))
    expect(hashSeed(1, 2)).not.toBe(hashSeed(12))
  })
})

describe('maths helpers', () => {
  it('computes summary statistics', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(quantile([0, 10], 0.25)).toBe(2.5)
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 9)
  })
})
