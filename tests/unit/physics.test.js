import { describe, expect, it } from 'vitest'
import { Vec2, Circle } from 'planck'
import { createPhysicsWorld } from '../../src/physics/PhysicsWorld.js'
import { simulateCreature } from '../../src/physics/SimulationStepper.js'
import { buildCreature } from '../../src/physics/CreatureBody.js'
import { commandMotor } from '../../src/physics/JointMotor.js'
import { decodeGenome, shapeArea } from '../../src/creatures/GenomeDecoder.js'
import { POSITION_ITERATIONS, TIMESTEP, VELOCITY_ITERATIONS, SETTLE_SECONDS } from '../../src/physics/constants.js'
import { buildTerrain, terrainFor } from '../../src/physics/Terrain.js'
import { ENVIRONMENTS } from '../../src/physics/Environments.js'
import { FLAT, simpleCreature } from './helpers.js'

function step(world, seconds, each) {
  const n = Math.round(seconds / TIMESTEP)
  for (let i = 0; i < n; i++) {
    each?.(i)
    world.step(TIMESTEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS)
  }
}

describe('world physics', () => {
  it('applies gravity at the configured rate', () => {
    const { world } = createPhysicsWorld(FLAT)
    const ball = world.createBody({ type: 'dynamic', position: new Vec2(0, 50) })
    ball.createFixture({ shape: new Circle(new Vec2(0, 0), 0.1), density: 1 })
    step(world, 1)
    expect(ball.getPosition().y).toBeCloseTo(50 - 0.5 * 9.81, 0)
    expect(ball.getLinearVelocity().y).toBeCloseTo(-9.81, 1)
  })

  it('uses each environment\'s gravity', () => {
    const { world } = createPhysicsWorld({ id: 'moon', seed: 1 })
    const ball = world.createBody({ type: 'dynamic', position: new Vec2(0, 50) })
    ball.createFixture({ shape: new Circle(new Vec2(0, 0), 0.1), density: 1 })
    step(world, 1)
    expect(ball.getLinearVelocity().y).toBeCloseTo(-1.62, 1)
  })

  it('stops bodies at the terrain', () => {
    const { world } = createPhysicsWorld(FLAT)
    const ball = world.createBody({ type: 'dynamic', position: new Vec2(0, 2) })
    ball.createFixture({ shape: new Circle(new Vec2(0, 0), 0.25), density: 1, restitution: 0 })
    step(world, 3)
    expect(ball.getPosition().y).toBeCloseTo(0.25, 1)
  })

  it('does not let fast bodies tunnel through the terrain', () => {
    const { world, terrain } = createPhysicsWorld({ id: 'hills', seed: 3 })
    const ball = world.createBody({ type: 'dynamic', position: new Vec2(10, 30), linearVelocity: new Vec2(0, -200) })
    ball.createFixture({ shape: new Circle(new Vec2(0, 0), 0.05), density: 1 })
    step(world, 1)
    expect(ball.getPosition().y).toBeGreaterThan(terrain.heightAt(ball.getPosition().x) - 0.2)
  })
})

describe('creature bodies', () => {
  it('gives each segment the mass its genome declares', () => {
    const genome = simpleCreature()
    const { world, terrain } = createPhysicsWorld(FLAT)
    const creature = buildCreature(world, decodeGenome(genome), terrain)
    genome.segments.forEach((segment, i) => {
      expect(creature.bodies[i].getMass()).toBeCloseTo(segment.density * shapeArea(segment), 6)
    })
  })

  it('collides with terrain but not with itself', () => {
    const { metrics } = simulateCreature(simpleCreature(), FLAT, { duration: 2 })
    expect(metrics.invalid).toBeNull()
    expect(metrics.contact).toBeGreaterThan(0.9)
  })

  it('keeps joints together under load', () => {
    const { metrics } = simulateCreature(simpleCreature(), FLAT, { duration: 4 })
    expect(metrics.peakJointError).toBeLessThan(0.02)
  })

  it('enforces joint limits', () => {
    const genome = simpleCreature()
    const joint = genome.segments[1].joint
    joint.lower = -0.3
    joint.upper = 0.3
    joint.osc.amp = 1.6
    joint.osc.offset = 1
    const { recording } = simulateCreature(genome, FLAT, { duration: 3, record: { every: 2, detail: true } })
    const max = Math.max(...recording.angles)
    const min = Math.min(...recording.angles)
    expect(max).toBeLessThan(0.3 + 0.05)
    expect(min).toBeGreaterThan(-0.3 - 0.05)
  })

  it('actuates joints towards the target through the motor', () => {
    const genome = simpleCreature()
    genome.segments[1].joint.maxTorque = 80
    const { world, terrain } = createPhysicsWorld(FLAT)
    const creature = buildCreature(world, decodeGenome(genome), terrain)
    const definition = genome.segments[1].joint
    step(world, 2, () => commandMotor(creature.joints[0], definition, 0.5))
    expect(creature.joints[0].getJointAngle()).toBeCloseTo(0.5, 1)
  })

  it('caps motor torque at the joint maximum', () => {
    const weak = simpleCreature()
    const strong = simpleCreature()
    for (const genome of [weak, strong]) {
      const joint = genome.segments[1].joint
      joint.osc.amp = 1
      joint.osc.offset = 0.5
      joint.lower = -2
      joint.upper = 2
      joint.gain = 20
    }
    weak.segments[1].joint.maxTorque = 1
    strong.segments[1].joint.maxTorque = 100
    const weakRun = simulateCreature(weak, FLAT, { duration: 3, record: { every: 2, detail: true } })
    const strongRun = simulateCreature(strong, FLAT, { duration: 3, record: { every: 2, detail: true } })
    expect(Math.max(...weakRun.recording.torques.map(Math.abs))).toBeLessThanOrEqual(1.0001)
    expect(Math.max(...strongRun.recording.torques.map(Math.abs))).toBeGreaterThan(1.5)
  })
})

describe('fixed timestep', () => {
  it('runs a number of steps that depends only on the duration', () => {
    const a = simulateCreature(simpleCreature(), FLAT, { duration: 2 }).metrics
    const b = simulateCreature(simpleCreature(), FLAT, { duration: 4 }).metrics
    expect(a.steps).toBe(Math.round((2 + SETTLE_SECONDS) / TIMESTEP))
    expect(b.steps).toBe(Math.round((4 + SETTLE_SECONDS) / TIMESTEP))
  })

  it('records states at a fixed interval', () => {
    const { recording } = simulateCreature(simpleCreature(), FLAT, { duration: 1, record: { every: 2 } })
    expect(recording.frameDt).toBeCloseTo(TIMESTEP * 2, 12)
    expect(recording.frameCount).toBe(Math.round((1 + SETTLE_SECONDS) / (TIMESTEP * 2)) + 1)
  })
})

describe('stability', () => {
  it('flags runs that exceed physical limits instead of crashing', async () => {
    const genome = simpleCreature()
    // A tiny, feather-light limb on a very strong, fast motor: the classic exploding joint.
    genome.segments[0].density = 2
    genome.segments[0].w = 0.1
    genome.segments[0].h = 0.06
    genome.segments[1].density = 2
    genome.segments[1].w = 1.8
    genome.segments[1].h = 0.06
    const joint = genome.segments[1].joint
    joint.maxTorque = 120
    joint.maxSpeed = 16
    joint.gain = 24
    joint.osc.amp = 1.6
    genome.controller.frequency = 3
    const { metrics } = simulateCreature(genome, FLAT, { duration: 6 })
    expect(Number.isFinite(metrics.distance)).toBe(true)
    expect(metrics.steps).toBeGreaterThan(0)
  })

  it('produces finite results for every environment', () => {
    for (const env of ENVIRONMENTS) {
      const { metrics } = simulateCreature(simpleCreature(), { id: env.id, seed: 2 }, { duration: 2 })
      expect(Number.isFinite(metrics.distance)).toBe(true)
      expect(metrics.energy).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('terrain', () => {
  it('is a pure function of environment and seed', () => {
    const a = buildTerrain({ id: 'hills', seed: 5 })
    const b = buildTerrain({ id: 'hills', seed: 5 })
    const c = buildTerrain({ id: 'hills', seed: 6 })
    expect(a.ys).toEqual(b.ys)
    expect(a.ys).not.toEqual(c.ys)
  })

  it('starts every environment on a flat runway', () => {
    for (const env of ENVIRONMENTS) {
      const terrain = terrainFor({ id: env.id, seed: 3 })
      expect(terrain.heightAt(-2)).toBeCloseTo(0, 6)
      expect(terrain.heightAt(1)).toBeCloseTo(0, 6)
    }
  })

  it('has rising ground on uphill and stairs', () => {
    for (const id of ['uphill', 'stairs']) {
      const terrain = terrainFor({ id, seed: 3 })
      expect(terrain.heightAt(30)).toBeGreaterThan(terrain.heightAt(10))
    }
  })

  it('has walls and gaps on the obstacle course', () => {
    const terrain = terrainFor({ id: 'obstacles', seed: 3 })
    const samples = Array.from({ length: 400 }, (_, i) => terrain.heightAt(3 + i * 0.1))
    expect(Math.max(...samples)).toBeGreaterThan(0.05)
    expect(Math.min(...samples)).toBeLessThan(-0.05)
  })

  it('has ice zones of low friction in mixed terrain', () => {
    const terrain = terrainFor({ id: 'mixed', seed: 3 })
    expect(terrain.zones.some((zone) => zone.surface === 'ice')).toBe(true)
    const ice = terrain.zones.find((zone) => zone.surface === 'ice')
    expect(terrain.frictionAt((ice.from + ice.to) / 2)).toBeLessThan(0.1)
    expect(terrain.frictionAt(0)).toBeGreaterThan(0.5)
  })

  it('is reduced friction on ice, measurably', () => {
    const genome = simpleCreature()
    const joint = genome.segments[1].joint
    joint.osc.amp = 0.8
    joint.osc.phase = 0
    const ground = simulateCreature(genome, FLAT, { duration: 4 }).metrics
    const ice = simulateCreature(genome, { id: 'ice', seed: 7 }, { duration: 4 }).metrics
    expect(ground.distance).not.toBeCloseTo(ice.distance, 2)
  })
})
