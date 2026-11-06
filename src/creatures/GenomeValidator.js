// Validation reports what is wrong; repair fixes what can be fixed safely.
import { BOUNDS, HARMONICS, SCHEMA_VERSION, SHAPES, DEFAULT_JOINT, DEFAULT_OSC, DEFAULT_SEGMENT } from './Genome.js'
import { clamp, wrapAngle } from '../lib/math.js'
import { MAX_SEGMENTS } from '../physics/constants.js'
import { neuralWeightCount } from '../controllers/NeuralController.js'

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/** Returns a list of {segment?, message} problems. An empty list means the genome is valid. */
export function validateGenome(genome) {
  const problems = []
  if (!genome || typeof genome !== 'object') return [{ message: 'This is not a creature file.' }]
  if (genome.schema !== SCHEMA_VERSION) problems.push({ message: `Unsupported genome version ${genome.schema}.` })
  if (!Array.isArray(genome.segments) || genome.segments.length === 0) {
    return [...problems, { message: 'A creature needs at least one body segment.' }]
  }
  if (genome.segments.length > MAX_SEGMENTS) {
    problems.push({ message: `A creature can have at most ${MAX_SEGMENTS} segments; this one has ${genome.segments.length}.` })
  }
  let roots = 0
  genome.segments.forEach((segment, index) => {
    const add = (message) => problems.push({ segment: index, message })
    if (!SHAPES.includes(segment.shape)) add(`Segment ${index + 1} has an unknown shape.`)
    if (!isNumber(segment.w) || segment.w < BOUNDS.w[0] || segment.w > BOUNDS.w[1]) add(`Segment ${index + 1} has an impossible length.`)
    if (segment.shape !== 'circle' && (!isNumber(segment.h) || segment.h < BOUNDS.h[0] || segment.h > BOUNDS.h[1])) {
      add(`Segment ${index + 1} has an impossible thickness.`)
    }
    if (!isNumber(segment.density) || segment.density <= 0) add(`Segment ${index + 1} has no mass.`)
    if (!isNumber(segment.friction) || segment.friction < 0) add(`Segment ${index + 1} has invalid friction.`)
    if (!isNumber(segment.restitution) || segment.restitution < 0) add(`Segment ${index + 1} has invalid bounciness.`)
    if (segment.parent === null || segment.parent === undefined) {
      roots++
      if (index !== 0) add(`Segment ${index + 1} is not connected to the body.`)
      return
    }
    if (!Number.isInteger(segment.parent) || segment.parent < 0 || segment.parent >= index) {
      add(`Segment ${index + 1} is connected to a segment that does not exist.`)
      return
    }
    const joint = segment.joint
    if (!joint) {
      add(`Segment ${index + 1} has no joint.`)
      return
    }
    for (const key of ['rest', 'lower', 'upper', 'maxTorque', 'maxSpeed', 'damping', 'gain']) {
      if (!isNumber(joint[key])) add(`Segment ${index + 1} has an invalid joint value (${key}).`)
    }
    if (joint.lower > joint.upper) add(`Segment ${index + 1} has joint limits the wrong way round.`)
    if (!joint.anchorParent || !joint.anchorChild) add(`Segment ${index + 1} is missing a joint anchor.`)
    if (!joint.osc) add(`Segment ${index + 1} has no motor pattern.`)
  })
  if (roots !== 1) problems.push({ message: 'A creature needs exactly one root segment.' })
  const controller = genome.controller
  if (!controller || !['oscillator', 'neural'].includes(controller.type)) {
    problems.push({ message: 'The creature has no valid controller.' })
  } else {
    if (!isNumber(controller.frequency)) problems.push({ message: 'The controller has no valid frequency.' })
    if (controller.type === 'neural') {
      const neural = controller.neural
      if (!neural || !Array.isArray(neural.weights)) {
        problems.push({ message: 'The neural controller has no weights.' })
      } else if (problems.length === 0 && neural.weights.length !== neuralWeightCount(genome, neural.hidden)) {
        problems.push({ message: 'The neural weights do not match this body.' })
      }
    }
  }
  return problems
}

/**
 * Clamps every parameter into bounds and fills missing fields, returning a new genome.
 * Structure it cannot fix (no segments at all) throws; callers report that to the user.
 */
export function repairGenome(input) {
  if (!input || !Array.isArray(input.segments) || input.segments.length === 0) {
    throw new Error('A creature needs at least one body segment.')
  }
  const b = BOUNDS
  const num = (value, fallback, range) => clamp(isNumber(value) ? value : fallback, range[0], range[1])
  const segments = input.segments.slice(0, MAX_SEGMENTS).map((raw, index) => {
    const shape = SHAPES.includes(raw.shape) ? raw.shape : DEFAULT_SEGMENT.shape
    const w = num(raw.w, DEFAULT_SEGMENT.w, b.w)
    const thickness = num(raw.h, DEFAULT_SEGMENT.h, b.h)
    const h = shape === 'circle' ? w : shape === 'capsule' ? Math.min(thickness, w) : thickness
    const parent = index === 0 ? null : Number.isInteger(raw.parent) && raw.parent >= 0 && raw.parent < index ? raw.parent : 0
    const segment = {
      id: typeof raw.id === 'string' ? raw.id : `s${index}`,
      shape,
      w,
      h,
      density: num(raw.density, DEFAULT_SEGMENT.density, b.density),
      friction: num(raw.friction, DEFAULT_SEGMENT.friction, b.friction),
      restitution: num(raw.restitution, DEFAULT_SEGMENT.restitution, b.restitution),
      color: typeof raw.color === 'string' ? raw.color.slice(0, 16) : '#8a8f7a',
      parent,
      joint: null,
    }
    if (parent !== null) {
      const j = raw.joint ?? {}
      let lower = num(j.lower, DEFAULT_JOINT.lower, b.lower)
      let upper = num(j.upper, DEFAULT_JOINT.upper, b.upper)
      if (lower > upper) [lower, upper] = [upper, lower]
      const osc = j.osc ?? {}
      segment.joint = {
        anchorParent: { u: num(j.anchorParent?.u, 0, b.anchor), v: num(j.anchorParent?.v, 0, b.anchor) },
        anchorChild: { u: num(j.anchorChild?.u, -1, b.anchor), v: num(j.anchorChild?.v, 0, b.anchor) },
        rest: num(j.rest, DEFAULT_JOINT.rest, b.rest),
        lower,
        upper,
        maxTorque: num(j.maxTorque, DEFAULT_JOINT.maxTorque, b.maxTorque),
        maxSpeed: num(j.maxSpeed, DEFAULT_JOINT.maxSpeed, b.maxSpeed),
        damping: num(j.damping, DEFAULT_JOINT.damping, b.damping),
        gain: num(j.gain, DEFAULT_JOINT.gain, b.gain),
        osc: {
          amp: num(osc.amp, DEFAULT_OSC.amp, b.amp),
          phase: wrapAngle(isNumber(osc.phase) ? osc.phase : 0),
          offset: num(osc.offset, 0, b.offset),
          harmonic: HARMONICS.includes(osc.harmonic) ? osc.harmonic : 1,
          dir: osc.dir === -1 ? -1 : 1,
        },
      }
    }
    return segment
  })
  const controller = input.controller ?? {}
  const type = controller.type === 'neural' ? 'neural' : 'oscillator'
  const genome = {
    schema: SCHEMA_VERSION,
    name: typeof input.name === 'string' ? input.name.slice(0, 60) : 'unnamed',
    rootAngle: isNumber(input.rootAngle) ? wrapAngle(input.rootAngle) : 0,
    segments,
    controller: { type, frequency: num(controller.frequency, 1, b.frequency), neural: null },
  }
  if (input.lineage) genome.lineage = input.lineage
  if (typeof input.tagline === 'string') genome.tagline = input.tagline.slice(0, 120)
  if (type === 'neural') {
    const hidden = Math.round(num(controller.neural?.hidden, 8, b.hidden))
    const expected = neuralWeightCount(genome, hidden)
    const weights = Array.isArray(controller.neural?.weights) ? controller.neural.weights : []
    genome.controller.neural = {
      hidden,
      weights: Array.from({ length: expected }, (_, i) => num(weights[i], 0, b.weight)),
    }
  }
  return genome
}

/** Parses untrusted text or objects into a safe genome, throwing a readable error. */
export function importGenome(data) {
  let value = data
  if (typeof data === 'string') {
    if (data.length > 2_000_000) throw new Error('This file is too large to be a creature.')
    try {
      value = JSON.parse(data)
    } catch {
      throw new Error('This file is not valid JSON.')
    }
  }
  if (value && value.kind === 'evolve/creature' && value.genome) value = value.genome
  if (!value || typeof value !== 'object' || !Array.isArray(value.segments)) {
    throw new Error('This file does not contain an evolve creature.')
  }
  if (value.schema !== undefined && value.schema > SCHEMA_VERSION) {
    throw new Error(`This creature needs a newer version of evolve (schema ${value.schema}).`)
  }
  const repaired = repairGenome(value)
  const problems = validateGenome(repaired)
  if (problems.length) throw new Error(problems[0].message)
  return repaired
}
