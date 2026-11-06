import { describe, expect, it } from 'vitest'
import { BOUNDS, cloneGenome, genomeHash, listGenes, topologySignature } from '../../src/creatures/Genome.js'
import { importGenome, repairGenome, validateGenome } from '../../src/creatures/GenomeValidator.js'
import { decodeGenome, shapeArea } from '../../src/creatures/GenomeDecoder.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { COMPLEXITY, generateCreature } from '../../src/creatures/CreatureGenerator.js'
import { mutateGenome, structuralMutation } from '../../src/evolution/Mutation.js'
import { toNeural } from '../../src/evolution/Population.js'
import { Rng } from '../../src/lib/rng.js'
import { MAX_SEGMENTS } from '../../src/physics/constants.js'
import { simulateCreature } from '../../src/physics/SimulationStepper.js'
import { FLAT } from './helpers.js'

describe('starters', () => {
  it('has the six distinct starter creatures the brief asks for', () => {
    const presets = createPresets()
    expect(presets.map((genome) => genome.name)).toEqual(['strider', 'trestle', 'pogo', 'inchworm', 'lopsided', 'stray'])
    const signatures = new Set(presets.map(topologySignature))
    expect(signatures.size).toBe(6)
    for (const genome of presets) expect(validateGenome(genome)).toEqual([])
  })

  it('starts out incompetent: none has evolved locomotion to begin with', () => {
    for (const genome of createPresets()) {
      const { metrics } = simulateCreature(genome, FLAT, { duration: 12 })
      expect(metrics.distance).toBeLessThan(5)
    }
  })
})

describe('serialisation', () => {
  it('survives a JSON round trip unchanged', () => {
    for (const genome of createPresets()) {
      const text = JSON.stringify(genome)
      const back = importGenome(text)
      expect(back.segments).toEqual(genome.segments)
      expect(back.controller).toEqual(genome.controller)
      expect(genomeHash(back)).toBe(genomeHash(genome))
    }
  })

  it('recreates the same physical configuration from the same genome', () => {
    for (const genome of createPresets()) {
      expect(decodeGenome(cloneGenome(genome))).toEqual(decodeGenome(genome))
    }
  })

  it('carries a schema version', () => {
    expect(createPresets()[0].schema).toBe(1)
    expect(() => importGenome({ schema: 99, segments: [{}] })).toThrow(/newer version/)
  })

  it('hashes physics, not cosmetics', () => {
    const genome = createPresets()[0]
    const painted = cloneGenome(genome)
    painted.segments[0].color = '#000000'
    painted.name = 'renamed'
    expect(genomeHash(painted)).toBe(genomeHash(genome))
    painted.segments[0].w += 0.01
    expect(genomeHash(painted)).not.toBe(genomeHash(genome))
  })
})

describe('validation', () => {
  const base = () => cloneGenome(createPresets()[0])

  it('rejects structure that cannot simulate', () => {
    expect(validateGenome(null)).not.toEqual([])
    expect(validateGenome({ schema: 1, segments: [] }).length).toBeGreaterThan(0)
    const disconnected = base()
    disconnected.segments[2].parent = null
    expect(validateGenome(disconnected).some((problem) => /not connected|root/.test(problem.message))).toBe(true)
    const forward = base()
    forward.segments[1].parent = 5
    expect(validateGenome(forward).some((problem) => /does not exist/.test(problem.message))).toBe(true)
    const noMass = base()
    noMass.segments[1].density = 0
    expect(validateGenome(noMass).some((problem) => /no mass/.test(problem.message))).toBe(true)
    const tooSmall = base()
    tooSmall.segments[1].w = 0
    expect(validateGenome(tooSmall).some((problem) => /impossible length/.test(problem.message))).toBe(true)
    const nan = base()
    nan.segments[1].joint.maxTorque = NaN
    expect(validateGenome(nan).some((problem) => /joint value/.test(problem.message))).toBe(true)
    const backwards = base()
    backwards.segments[1].joint.lower = 1
    backwards.segments[1].joint.upper = -1
    expect(validateGenome(backwards).some((problem) => /wrong way/.test(problem.message))).toBe(true)
  })

  it('repairs illegal values into bounds', () => {
    const genome = base()
    genome.segments[1].w = 999
    genome.segments[1].density = -5
    genome.segments[1].joint.maxTorque = 1e9
    genome.segments[1].joint.lower = 2
    genome.segments[1].joint.upper = -2
    const repaired = repairGenome(genome)
    expect(validateGenome(repaired)).toEqual([])
    expect(repaired.segments[1].w).toBe(BOUNDS.w[1])
    expect(repaired.segments[1].density).toBe(BOUNDS.density[0])
    expect(repaired.segments[1].joint.maxTorque).toBe(BOUNDS.maxTorque[1])
    expect(repaired.segments[1].joint.lower).toBeLessThanOrEqual(repaired.segments[1].joint.upper)
  })

  it('reports unusable imports readably', () => {
    expect(() => importGenome('not json')).toThrow(/not valid JSON/)
    expect(() => importGenome('{"hello":1}')).toThrow(/does not contain/)
    expect(() => importGenome({ segments: [] })).toThrow(/at least one/)
    expect(() => importGenome('x'.repeat(2_000_001))).toThrow(/too large/)
  })

  it('accepts exported creature files', () => {
    const genome = base()
    const back = importGenome({ kind: 'evolve/creature', genome })
    expect(back.segments.length).toBe(genome.segments.length)
  })
})

describe('mutation', () => {
  it('keeps every gene within bounds, however hard it is pushed', () => {
    const rng = new Rng(11)
    let genome = createPresets()[0]
    for (let i = 0; i < 400; i++) {
      genome = mutateGenome(genome, { rate: 1, strength: 2, resetRate: 0.2, bodyRate: 1 }, rng)
    }
    for (const gene of listGenes(genome)) {
      const value = gene.holder[gene.field]
      expect(value).toBeGreaterThanOrEqual(gene.min - 1e-9)
      expect(value).toBeLessThanOrEqual(gene.max + 1e-9)
    }
    expect(validateGenome(genome)).toEqual([])
  })

  it('still simulates after extreme mutation', () => {
    const rng = new Rng(5)
    let genome = createPresets()[3]
    for (let i = 0; i < 100; i++) genome = mutateGenome(genome, { rate: 1, strength: 1, bodyRate: 1 }, rng)
    const { metrics } = simulateCreature(genome, FLAT, { duration: 3 })
    expect(Number.isFinite(metrics.distance)).toBe(true)
  })

  it('never produces a silent clone', () => {
    const rng = new Rng(3)
    const genome = createPresets()[2]
    for (let i = 0; i < 50; i++) {
      const child = mutateGenome(genome, { rate: 0.001, strength: 0.1 }, rng)
      expect(JSON.stringify(child)).not.toBe(JSON.stringify(genome))
    }
  })

  it('does not touch the parent', () => {
    const genome = createPresets()[0]
    const before = JSON.stringify(genome)
    mutateGenome(genome, { rate: 1, strength: 0.5, bodyRate: 1 }, new Rng(2))
    expect(JSON.stringify(genome)).toBe(before)
  })

  it('freezes the body when the body rate is zero', () => {
    const genome = createPresets()[0]
    const child = mutateGenome(genome, { rate: 1, strength: 0.3, bodyRate: 0, resetRate: 0 }, new Rng(9))
    genome.segments.forEach((segment, i) => {
      expect(child.segments[i].w).toBe(segment.w)
      expect(child.segments[i].h).toBe(segment.h)
      expect(child.segments[i].density).toBe(segment.density)
    })
  })

  it('structural mutation keeps a valid rooted tree within the size limit', () => {
    const rng = new Rng(21)
    let genome = createPresets()[4]
    const sizes = new Set()
    for (let i = 0; i < 300; i++) {
      genome = repairGenome(structuralMutation(genome, rng))
      sizes.add(genome.segments.length)
      expect(validateGenome(genome)).toEqual([])
      expect(genome.segments.length).toBeLessThanOrEqual(MAX_SEGMENTS)
    }
    expect(sizes.size).toBeGreaterThan(2)
  })

  it('mutates neural weights within bounds', () => {
    const rng = new Rng(4)
    let genome = toNeural(createPresets()[0], rng, 6)
    const before = [...genome.controller.neural.weights]
    for (let i = 0; i < 50; i++) genome = mutateGenome(genome, { rate: 0.5, strength: 0.6 }, rng)
    const after = genome.controller.neural.weights
    expect(after).not.toEqual(before)
    for (const weight of after) {
      expect(Math.abs(weight)).toBeLessThanOrEqual(BOUNDS.weight[1])
    }
    expect(validateGenome(genome)).toEqual([])
  })
})

describe('random generator', () => {
  it('produces valid creatures at every complexity', () => {
    for (const complexity of Object.keys(COMPLEXITY)) {
      for (let seed = 1; seed <= 150; seed++) {
        const genome = generateCreature(new Rng(seed * 97), complexity)
        expect(validateGenome(genome)).toEqual([])
        expect(genome.segments.length).toBeLessThanOrEqual(COMPLEXITY[complexity].maxSegments)
        expect(decodeGenome(genome).mass).toBeGreaterThan(0)
      }
    }
  })

  it('makes different creatures from different seeds, the same from the same seed', () => {
    const a = generateCreature(new Rng(1))
    const b = generateCreature(new Rng(1))
    const c = generateCreature(new Rng(2))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('simulates generated creatures stably', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const genome = generateCreature(new Rng(seed * 13), 'complex')
      const { metrics } = simulateCreature(genome, FLAT, { duration: 2 })
      expect(Number.isFinite(metrics.distance)).toBe(true)
    }
  })
})

describe('decoder', () => {
  it('rests the lowest point on the ground and centres the mass', () => {
    for (const genome of createPresets()) {
      const phenotype = decodeGenome(genome)
      expect(phenotype.bounds.minY).toBeCloseTo(0, 9)
      const massX = phenotype.parts.reduce((sum, part) => sum + part.mass * part.x, 0) / phenotype.mass
      expect(massX).toBeCloseTo(0, 9)
    }
  })

  it('computes areas that match shape geometry', () => {
    expect(shapeArea({ shape: 'circle', w: 2, h: 2 })).toBeCloseTo(Math.PI, 9)
    expect(shapeArea({ shape: 'capsule', w: 1, h: 0.2 })).toBeCloseTo(0.8 * 0.2 + Math.PI * 0.01, 9)
  })
})
