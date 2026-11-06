import { describe, expect, it } from 'vitest'
import { simulateCreature } from '../../src/physics/SimulationStepper.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { evaluateGenome } from '../../src/evolution/evaluate.js'
import { computeFitness } from '../../src/evolution/Fitness.js'
import { FLAT } from './helpers.js'

describe('determinism', () => {
  it('reproduces identical runs for every starter', () => {
    for (const genome of createPresets()) {
      const a = simulateCreature(genome, FLAT, { duration: 4 }).metrics
      const b = simulateCreature(genome, FLAT, { duration: 4 }).metrics
      expect(a.stateHash).toBe(b.stateHash)
      expect(a.distance).toBe(b.distance)
      expect(a.energy).toBe(b.energy)
    }
  })

  it('does not change the outcome when recording', () => {
    const [genome] = createPresets()
    const plain = simulateCreature(genome, FLAT, { duration: 5 }).metrics
    const recorded = simulateCreature(genome, FLAT, { duration: 5, record: { every: 2, detail: true } }).metrics
    expect(recorded.stateHash).toBe(plain.stateHash)
    expect(recorded.distance).toBe(plain.distance)
  })

  it('replays match the evaluation that scored them', () => {
    const genome = createPresets()[1]
    const evaluated = evaluateGenome(genome, FLAT, { duration: 6, objective: 'distance' })
    const replay = simulateCreature(genome, FLAT, { duration: 6, record: { every: 2 } })
    expect(replay.metrics.stateHash).toBe(evaluated.metrics.stateHash)
    expect(computeFitness(replay.metrics, 'distance')).toBe(evaluated.fitness)
    // the last recorded COM is the same measurement the score used
    const r = replay.recording
    expect(r.com[(r.frameCount - 1) * 2] - replay.metrics.startX).toBeCloseTo(evaluated.metrics.distance, 4)
  })

  it('is unaffected by other simulations running in between', () => {
    const [a, b] = createPresets()
    const first = simulateCreature(a, FLAT, { duration: 3 }).metrics.stateHash
    simulateCreature(b, { id: 'hills', seed: 2 }, { duration: 3 })
    expect(simulateCreature(a, FLAT, { duration: 3 }).metrics.stateHash).toBe(first)
  })

  it('differs when the environment differs', () => {
    const [genome] = createPresets()
    const a = simulateCreature(genome, { id: 'flat', seed: 1 }, { duration: 6 }).metrics.stateHash
    const b = simulateCreature(genome, { id: 'moon', seed: 1 }, { duration: 6 }).metrics.stateHash
    expect(a).not.toBe(b)
  })
})
