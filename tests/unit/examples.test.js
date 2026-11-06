import { describe, expect, it } from 'vitest'
import { EVOLVED_EXAMPLES } from '../../src/creatures/evolvedExamples.js'
import { evaluateGenome } from '../../src/evolution/evaluate.js'
import { validateGenome } from '../../src/creatures/GenomeValidator.js'

describe('evolved examples', () => {
  it('exist, and are valid genomes', () => {
    expect(EVOLVED_EXAMPLES.length).toBeGreaterThanOrEqual(5)
    for (const genome of EVOLVED_EXAMPLES) expect(validateGenome(genome)).toEqual([])
  })

  it('still achieve exactly what their label claims when re-simulated', () => {
    for (const genome of EVOLVED_EXAMPLES) {
      const { lineage } = genome
      const { metrics } = evaluateGenome(genome, { id: lineage.env, seed: 7 }, { duration: lineage.duration })
      expect(metrics.stateHash).toBe(lineage.stateHash)
      expect(metrics.distance).toBe(lineage.distance)
    }
  })
})
