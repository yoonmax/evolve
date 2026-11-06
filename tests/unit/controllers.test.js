import { describe, expect, it } from 'vitest'
import { OscillatorController } from '../../src/controllers/OscillatorController.js'
import { NeuralController, forward, neuralWeightCount } from '../../src/controllers/NeuralController.js'
import { SensorEncoder, sensorCount, contactSensorSegments } from '../../src/controllers/SensorEncoder.js'
import { MotorDecoder } from '../../src/controllers/MotorDecoder.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { toNeural } from '../../src/evolution/Population.js'
import { simulateCreature } from '../../src/physics/SimulationStepper.js'
import { Rng } from '../../src/lib/rng.js'
import { FLAT, simpleCreature } from './helpers.js'

function state(genome, overrides = {}) {
  const joints = genome.segments.length - 1
  return { rootAngle: 0, rootSpin: 0, jointAngles: new Float64Array(joints), jointSpeeds: new Float64Array(joints), contacts: new Uint8Array(genome.segments.length), ...overrides }
}

describe('oscillator controller', () => {
  it('follows offset + amp sin(2 pi f t + phase)', () => {
    const genome = simpleCreature()
    const joint = genome.segments[1].joint
    joint.osc = { amp: 0.5, phase: 0.3, offset: 0.1, harmonic: 2, dir: 1 }
    genome.controller.frequency = 1.5
    const controller = new OscillatorController(genome)
    const out = new Float64Array(1)
    for (const t of [0, 0.1, 0.37, 1.9]) {
      controller.update(t, null, out)
      expect(out[0]).toBeCloseTo(0.1 + 0.5 * Math.sin(2 * Math.PI * 1.5 * 2 * t + 0.3), 10)
    }
  })

  it('reverses with the direction gene', () => {
    const genome = simpleCreature()
    genome.segments[1].joint.osc = { amp: 0.5, phase: 0, offset: 0, harmonic: 1, dir: -1 }
    const out = new Float64Array(1)
    new OscillatorController(genome).update(0.25, null, out)
    expect(out[0]).toBeCloseTo(-0.5, 9)
  })

  it('stays inside joint limits', () => {
    const genome = simpleCreature()
    const joint = genome.segments[1].joint
    joint.lower = -0.2
    joint.upper = 0.3
    joint.osc = { amp: 1.6, phase: 0, offset: 0, harmonic: 1, dir: 1 }
    const controller = new OscillatorController(genome)
    const out = new Float64Array(1)
    for (let t = 0; t < 2; t += 0.01) {
      controller.update(t, null, out)
      expect(out[0]).toBeLessThanOrEqual(0.3)
      expect(out[0]).toBeGreaterThanOrEqual(-0.2)
    }
  })
})

describe('sensor encoding', () => {
  const genome = createPresets()[0]

  it('has the documented size', () => {
    const joints = genome.segments.length - 1
    expect(sensorCount(genome)).toBe(5 + 2 * joints + contactSensorSegments(genome).length)
  })

  it('keeps every input in range', () => {
    const encoder = new SensorEncoder(genome)
    const out = new Float64Array(encoder.size)
    const wild = state(genome, { rootAngle: 40, rootSpin: 900, jointAngles: new Float64Array(6).fill(50), jointSpeeds: new Float64Array(6).fill(-90) })
    wild.contacts.fill(1)
    encoder.encode(wild, 123.4, out)
    for (const value of out) {
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('reflects measured body state', () => {
    const encoder = new SensorEncoder(genome)
    const contacts = new Uint8Array(genome.segments.length)
    const a = encoder.encode(state(genome), 0, new Float64Array(encoder.size))
    const leaf = contactSensorSegments(genome)[0]
    contacts[leaf] = 1
    const b = encoder.encode(state(genome, { contacts }), 0, new Float64Array(encoder.size))
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('neural controller', () => {
  const rng = new Rng(8)
  const genome = toNeural(createPresets()[0], rng, 8)

  it('has the weight count its architecture needs', () => {
    expect(genome.controller.neural.weights.length).toBe(neuralWeightCount(genome, 8))
  })

  it('computes a forward pass with bounded outputs', () => {
    const weights = Float64Array.from({ length: (2 + 1) * 3 + (3 + 1) * 1 }, (_, i) => (i % 2 ? 3 : -2))
    const out = forward(weights, 3, Float64Array.from([1, -1]), new Float64Array(1), new Float64Array(3))
    expect(Math.abs(out[0])).toBeLessThanOrEqual(1)
  })

  it('is deterministic and depends on its inputs', () => {
    const a = new NeuralController(genome)
    const b = new NeuralController(genome)
    const out1 = new Float64Array(6)
    const out2 = new Float64Array(6)
    a.update(0.5, state(genome), out1)
    b.update(0.5, state(genome), out2)
    expect(Array.from(out1)).toEqual(Array.from(out2))
    const c = new NeuralController(genome)
    const out3 = new Float64Array(6)
    c.update(0.5, state(genome, { rootAngle: 1.2, rootSpin: 4 }), out3)
    expect(Array.from(out3)).not.toEqual(Array.from(out1))
  })

  it('keeps targets inside joint limits', () => {
    const controller = new NeuralController(genome)
    const out = new Float64Array(6)
    for (let t = 0; t < 2; t += 1 / 60) {
      controller.update(t, state(genome), out)
      out.forEach((value, i) => {
        const joint = genome.segments[i + 1].joint
        expect(value).toBeGreaterThanOrEqual(joint.lower - 1e-9)
        expect(value).toBeLessThanOrEqual(joint.upper + 1e-9)
      })
    }
  })

  it('smooths commands, so it cannot dither motors faster than the filter allows', () => {
    const decoder = new MotorDecoder(simpleCreature())
    const out = new Float64Array(1)
    decoder.decode(Float64Array.from([1]), out)
    expect(out[0]).toBeLessThan(0.25)
    decoder.decode(Float64Array.from([1]), out)
    const second = out[0]
    decoder.decode(Float64Array.from([-1]), out)
    expect(second - out[0]).toBeLessThan(0.45)
  })

  it('actually drives the simulated joints', () => {
    const { recording, metrics } = simulateCreature(genome, FLAT, { duration: 3, record: { every: 2, detail: true } })
    expect(metrics.invalid).toBeNull()
    expect(metrics.jointTravel).toBeGreaterThan(0.1)
    expect(new Set(recording.targets).size).toBeGreaterThan(20)
    const other = toNeural(createPresets()[0], new Rng(99), 8)
    expect(simulateCreature(other, FLAT, { duration: 3 }).metrics.stateHash).not.toBe(metrics.stateHash)
  })
})
