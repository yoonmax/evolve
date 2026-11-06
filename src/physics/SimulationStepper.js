// Runs one creature through one environment on a fixed timestep and measures what really
// happened. Recording only reads physics state, so a recorded run and an unrecorded run
// of the same genome are identical; tests/unit/determinism.test.js holds that to bits.
import { createPhysicsWorld } from './PhysicsWorld.js'
import { buildCreature } from './CreatureBody.js'
import { applyJointDamping, commandMotor } from './JointMotor.js'
import {
  CONTROL_EVERY, MAX_BODY_SPEED, MAX_BODY_SPIN, MAX_JOINT_ERROR, MAX_JOINT_ERROR_STEPS, PHYSICS_VERSION,
  POSITION_ITERATIONS, SETTLE_SECONDS, TIMESTEP, TUNNEL_MARGIN, VELOCITY_ITERATIONS,
} from './constants.js'
import { decodeGenome } from '../creatures/GenomeDecoder.js'
import { createController } from '../controllers/createController.js'

const MAX_CONTACT_POINTS = 8
const SPEED_WINDOW_SECONDS = 3
const FNV_PRIME = 0x01000193

function hashNumbers(values) {
  let h = 0x811c9dc5
  for (const value of values) {
    const text = String(value)
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, FNV_PRIME)
    }
  }
  return (h >>> 0).toString(36)
}

function createRecording(frameCount, bodyCount, jointCount, every, detail) {
  const recording = {
    every,
    frameDt: every * TIMESTEP,
    bodyCount,
    jointCount,
    frameCount: 0,
    capacity: frameCount,
    poses: new Float32Array(frameCount * bodyCount * 3),
    com: new Float32Array(frameCount * 2),
    energy: new Float32Array(frameCount),
    contacts: new Uint32Array(frameCount),
    detail,
  }
  if (detail) {
    recording.angles = new Float32Array(frameCount * jointCount)
    recording.targets = new Float32Array(frameCount * jointCount)
    recording.torques = new Float32Array(frameCount * jointCount)
    recording.points = new Float32Array(frameCount * MAX_CONTACT_POINTS * 4).fill(NaN)
    recording.maxPoints = MAX_CONTACT_POINTS
  }
  return recording
}

function trimRecording(recording) {
  const n = recording.frameCount
  if (n === recording.capacity) return recording
  const stride = recording.bodyCount * 3
  const trimmed = {
    ...recording,
    capacity: n,
    poses: recording.poses.slice(0, n * stride),
    com: recording.com.slice(0, n * 2),
    energy: recording.energy.slice(0, n),
    contacts: recording.contacts.slice(0, n),
  }
  if (recording.detail) {
    trimmed.angles = recording.angles.slice(0, n * recording.jointCount)
    trimmed.targets = recording.targets.slice(0, n * recording.jointCount)
    trimmed.torques = recording.torques.slice(0, n * recording.jointCount)
    trimmed.points = recording.points.slice(0, n * MAX_CONTACT_POINTS * 4)
  }
  return trimmed
}

/**
 * @param genome   a validated genome
 * @param envConfig {id, seed, gravity?, friction?}
 * @param options  {duration, spawnX, record: {every, detail} | null, finishLine}
 * @returns {metrics, recording?}
 */
export function simulateCreature(genome, envConfig, options = {}) {
  const { duration = 12, spawnX = 0, record = null, finishLine = null } = options
  const phenotype = decodeGenome(genome)
  const { world, terrain, env } = createPhysicsWorld(envConfig)
  const creature = buildCreature(world, phenotype, terrain, spawnX)
  const { bodies, joints, mass } = creature
  const definitions = genome.segments.slice(1).map((segment) => segment.joint)
  const bodyCount = bodies.length
  const jointCount = joints.length
  const controller = createController(genome)

  const settleSteps = Math.round(SETTLE_SECONDS / TIMESTEP)
  const runSteps = Math.round(duration / TIMESTEP)
  const totalSteps = settleSteps + runSteps

  const every = record?.every ?? 4
  const recording = record
    ? createRecording(Math.ceil(totalSteps / every) + 1, bodyCount, jointCount, every, Boolean(record.detail))
    : null

  const state = {
    rootAngle: bodies[0].getAngle(),
    rootSpin: 0,
    jointAngles: new Float64Array(jointCount),
    jointSpeeds: new Float64Array(jointCount),
    contacts: new Uint8Array(bodyCount),
  }
  const targets = new Float64Array(jointCount)
  const torques = new Float64Array(jointCount)
  const inverseDt = 1 / TIMESTEP
  const windowSamples = Math.round(SPEED_WINDOW_SECONDS / (TIMESTEP * 30))
  const comSamples = new Float64Array(windowSamples + 1)
  let comSampleCount = 0

  const root = bodies[0]
  const restAngle = genome.rootAngle ?? 0
  let comX = 0
  let comY = 0
  const readCom = () => {
    let x = 0
    let y = 0
    for (let i = 0; i < bodyCount; i++) {
      const body = bodies[i]
      const c = body.getWorldCenter()
      const m = body.getMass()
      x += c.x * m
      y += c.y * m
    }
    comX = x / mass
    comY = y / mass
  }

  const writeFrame = () => {
    const frame = recording.frameCount
    if (frame >= recording.capacity) return
    const offset = frame * bodyCount * 3
    let mask = 0
    for (let i = 0; i < bodyCount; i++) {
      const p = bodies[i].getPosition()
      recording.poses[offset + i * 3] = p.x
      recording.poses[offset + i * 3 + 1] = p.y
      recording.poses[offset + i * 3 + 2] = bodies[i].getAngle()
      if (state.contacts[i] && i < 32) mask |= 1 << i
    }
    recording.com[frame * 2] = comX
    recording.com[frame * 2 + 1] = comY
    recording.energy[frame] = energy
    recording.contacts[frame] = mask >>> 0
    if (recording.detail) {
      for (let i = 0; i < jointCount; i++) {
        recording.angles[frame * jointCount + i] = state.jointAngles[i]
        recording.targets[frame * jointCount + i] = targets[i]
        recording.torques[frame * jointCount + i] = torques[i]
      }
      writeContactPoints(frame)
    }
    recording.frameCount = frame + 1
  }

  const writeContactPoints = (frame) => {
    let written = 0
    for (let c = world.getContactList(); c && written < MAX_CONTACT_POINTS; c = c.getNext()) {
      if (!c.isTouching()) continue
      const manifold = c.getManifold()
      const worldManifold = c.getWorldManifold(null)
      if (!worldManifold) continue
      for (let p = 0; p < manifold.pointCount && written < MAX_CONTACT_POINTS; p++) {
        const force = manifold.points[p].normalImpulse * inverseDt
        const offset = (frame * MAX_CONTACT_POINTS + written) * 4
        recording.points[offset] = worldManifold.points[p].x
        recording.points[offset + 1] = worldManifold.points[p].y
        // normal points from fixture A to B; A is whichever was created first (terrain)
        recording.points[offset + 2] = worldManifold.normal.x * force
        recording.points[offset + 3] = worldManifold.normal.y * force
        written++
      }
    }
  }

  const readState = () => {
    state.rootAngle = root.getAngle()
    state.rootSpin = root.getAngularVelocity()
    for (let i = 0; i < jointCount; i++) {
      state.jointAngles[i] = joints[i].getJointAngle()
      state.jointSpeeds[i] = joints[i].getJointSpeed()
    }
    for (let i = 0; i < bodyCount; i++) {
      let touching = 0
      for (let edge = bodies[i].getContactList(); edge; edge = edge.next) {
        if (edge.contact.isTouching()) {
          touching = 1
          break
        }
      }
      state.contacts[i] = touching
    }
  }

  // Measurements
  let energy = 0
  let startX = 0
  let startHeight = 0
  let furthest = -Infinity
  let peakHeight = 0
  let uprightTime = 0
  let contactTime = 0
  let bodyDragTime = 0
  let airTime = 0
  let jointTravel = 0
  let falls = 0
  let recoveries = 0
  let wasUpright = true
  let bestWindowSpeed = 0
  let invalid = null
  let invalidAt = null
  let elapsed = 0
  let finishTime = null
  let jointErrorRun = 0
  let peakJointError = 0
  let stepsRun = 0
  const previousAngles = new Float64Array(jointCount)

  readCom()
  readState()
  if (recording) writeFrame()

  for (let step = 0; step < totalSteps; step++) {
    const settling = step < settleSteps
    if (step === settleSteps) {
      readCom()
      startX = comX
      startHeight = comY - terrain.heightAt(comX)
      furthest = 0
      comSamples[0] = comX
      comSampleCount = 1
      previousAngles.set(state.jointAngles)
    }

    if (step % CONTROL_EVERY === 0) {
      readState()
      const t = (step - settleSteps) * TIMESTEP
      if (settling) targets.fill(0)
      else controller.update(t, state, targets)
      for (let j = 0; j < jointCount; j++) commandMotor(joints[j], definitions[j], targets[j])
    }
    for (let j = 0; j < jointCount; j++) {
      if (definitions[j].damping > 0) applyJointDamping(joints[j], definitions[j], state.jointSpeeds[j])
    }

    world.step(TIMESTEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS)
    stepsRun++

    const controlTickEnd = (step + 1) % CONTROL_EVERY === 0
    if (controlTickEnd) {
      const controlDt = TIMESTEP * CONTROL_EVERY
      readCom()
      for (let j = 0; j < jointCount; j++) {
        const torque = joints[j].getMotorTorque(inverseDt)
        torques[j] = torque
        if (!settling) energy += Math.abs(torque * joints[j].getJointSpeed()) * controlDt
      }

      // Stability checks. Any failure ends the run; the penalty is applied by Fitness.js.
      if (!Number.isFinite(comX) || !Number.isFinite(comY)) invalid = 'non-finite state'
      for (let i = 0; i < bodyCount && !invalid; i++) {
        const v = bodies[i].getLinearVelocity()
        const speed2 = v.x * v.x + v.y * v.y
        if (!(speed2 < MAX_BODY_SPEED * MAX_BODY_SPEED)) invalid = 'body exceeded the speed limit'
        else if (!(Math.abs(bodies[i].getAngularVelocity()) < MAX_BODY_SPIN)) invalid = 'body exceeded the spin limit'
      }
      if (!invalid && comY < terrain.heightAt(comX) - TUNNEL_MARGIN) invalid = 'body passed through the terrain'
      if (!invalid && step % 8 === 7) {
        let worst = 0
        for (let j = 0; j < jointCount; j++) {
          const a = joints[j].getAnchorA()
          const b = joints[j].getAnchorB()
          const dx = a.x - b.x
          const dy = a.y - b.y
          const e = Math.sqrt(dx * dx + dy * dy)
          if (e > worst) worst = e
        }
        if (worst > peakJointError) peakJointError = worst
        jointErrorRun = worst > MAX_JOINT_ERROR ? jointErrorRun + 1 : 0
        if (jointErrorRun >= MAX_JOINT_ERROR_STEPS) invalid = 'joint came apart'
      }

      if (!settling) {
        elapsed += controlDt
        const forward = comX - startX
        if (forward > furthest) furthest = forward
        const height = comY - terrain.heightAt(comX)
        if (height - startHeight > peakHeight) peakHeight = height - startHeight
        let relative = state.rootAngle - restAngle
        relative = Math.abs(((relative + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI)
        const upright = relative < 0.9 && height > startHeight * 0.55
        if (upright) uprightTime += controlDt
        if (wasUpright && !upright) falls++
        if (!wasUpright && upright) recoveries++
        wasUpright = upright
        let anyContact = false
        for (let i = 0; i < bodyCount; i++) {
          if (state.contacts[i]) {
            anyContact = true
            break
          }
        }
        if (state.contacts[0]) bodyDragTime += controlDt
        if (anyContact) contactTime += controlDt
        else airTime += controlDt
        for (let j = 0; j < jointCount; j++) {
          const delta = state.jointAngles[j] - previousAngles[j]
          jointTravel += delta < 0 ? -delta : delta
          previousAngles[j] = state.jointAngles[j]
        }
        if (finishLine !== null && finishTime === null && comX >= finishLine) finishTime = elapsed
        // speed over the best three-second window, sampled at 4 Hz
        if ((step + 1 - settleSteps) % 30 === 0) {
          if (comSampleCount <= windowSamples) {
            comSamples[comSampleCount++] = comX
          } else {
            comSamples.copyWithin(0, 1)
            comSamples[windowSamples] = comX
          }
          if (comSampleCount > windowSamples) {
            const speed = (comSamples[windowSamples] - comSamples[0]) / SPEED_WINDOW_SECONDS
            if (speed > bestWindowSpeed) bestWindowSpeed = speed
          }
        }
      }
    }

    if (recording && (step + 1) % every === 0) writeFrame()
    if (invalid) {
      invalidAt = (step - settleSteps) * TIMESTEP
      break
    }
  }

  const finalX = Number.isFinite(comX) ? comX : startX
  const distance = finalX - startX
  const finalState = []
  for (const body of bodies) {
    const p = body.getPosition()
    finalState.push(p.x, p.y, body.getAngle())
  }
  const metrics = {
    distance,
    furthest: furthest === -Infinity ? 0 : furthest,
    avgSpeed: elapsed > 0 ? distance / elapsed : 0,
    bestSpeed: bestWindowSpeed,
    energy,
    energyNorm: energy / (mass * env.gravity),
    upright: elapsed > 0 ? uprightTime / elapsed : 0,
    contact: elapsed > 0 ? contactTime / elapsed : 0,
    bodyDrag: elapsed > 0 ? bodyDragTime / elapsed : 0,
    airTime,
    peakHeight,
    jointTravel,
    falls,
    recoveries,
    mass,
    elapsed,
    steps: stepsRun,
    startX,
    finishTime,
    peakJointError,
    invalid,
    invalidAt,
    stateHash: hashNumbers(finalState),
    physicsVersion: PHYSICS_VERSION,
  }
  return { metrics, recording: recording ? trimRecording(recording) : null }
}
