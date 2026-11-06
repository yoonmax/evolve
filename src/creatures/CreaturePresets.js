// The starting cast. Each has a real body and a deliberately naive controller: none of
// them walks well. Getting better is evolution's job.
import { SCHEMA_VERSION } from './Genome.js'
import { repairGenome } from './GenomeValidator.js'
import { generateCreature } from './CreatureGenerator.js'
import { Rng } from '../lib/rng.js'

export const PIGMENTS = {
  ochre: '#C8983F',
  moss: '#6F8F5A',
  slate: '#4F7290',
  plum: '#8C5C7E',
  clay: '#A9796A',
  mist: '#8FA3A3',
  ink: '#3A3D42',
}

let cursor = 0
const reset = () => {
  cursor = 0
}

function body(shape, w, h, color, extra = {}) {
  return { id: `s${cursor++}`, shape, w, h: shape === 'circle' ? w : h, density: 12, friction: 0.9, restitution: 0.05, color, parent: null, joint: null, ...extra }
}

function limb(parent, shape, w, h, color, joint, extra = {}) {
  const { pa, ca = [-0.85, 0], rest = 0, lower = -1, upper = 1, torque = 30, speed = 8, amp = 0.22, phase = 0, offset = 0, harmonic = 1, gain = 8, damping = 0.2 } = joint
  return {
    id: `s${cursor++}`, shape, w, h: shape === 'circle' ? w : h, density: 12, friction: 0.9, restitution: 0.05, color, parent,
    joint: {
      anchorParent: { u: pa[0], v: pa[1] }, anchorChild: { u: ca[0], v: ca[1] },
      rest, lower, upper, maxTorque: torque, maxSpeed: speed, damping, gain,
      osc: { amp, phase, offset, harmonic, dir: 1 },
    },
    ...extra,
  }
}

function finish(name, tagline, rootAngle, frequency, segments) {
  return repairGenome({ schema: SCHEMA_VERSION, name, tagline, rootAngle, segments, controller: { type: 'oscillator', frequency, neural: null } })
}

function strider() {
  reset()
  const { ochre, ink } = PIGMENTS
  const segments = [body('capsule', 0.72, 0.26, ochre, { density: 14 })]
  const leg = (phase, splay) => {
    const hip = segments.length
    segments.push(limb(0, 'capsule', 0.5, 0.13, ochre, { pa: [-0.82, 0], rest: Math.PI * -1 + splay, lower: -1.1, upper: 1.1, torque: 45, amp: 0.3, phase }))
    const knee = segments.length
    segments.push(limb(hip, 'capsule', 0.48, 0.11, ochre, { pa: [0.85, 0], rest: 0.08, lower: -0.2, upper: 1.5, torque: 35, amp: 0.25, phase: phase + 1, offset: 0.1 }))
    segments.push(limb(knee, 'capsule', 0.44, 0.08, ink, { pa: [0.85, 0], ca: [-0.2, 0], rest: Math.PI / 2, lower: -0.6, upper: 0.6, torque: 22, amp: 0.1, phase: phase + 2 }))
  }
  // Both legs in phase with each other: it can only lurch, which is the point.
  leg(0.2, 0.24)
  leg(0.5, -0.24)
  return finish('strider', 'Two legs, and no idea how balance works.', Math.PI / 2, 0.7, segments)
}

function trestle() {
  reset()
  const { moss, ink } = PIGMENTS
  const segments = [body('box', 1.15, 0.3, moss, { density: 10 })]
  const leg = (u, phase) => {
    const hip = segments.length
    segments.push(limb(0, 'capsule', 0.4, 0.12, moss, { pa: [u, -0.75], rest: -Math.PI / 2, lower: -1, upper: 1, torque: 30, amp: 0.3, phase }))
    segments.push(limb(hip, 'capsule', 0.36, 0.1, ink, { pa: [0.85, 0], rest: 0.15, lower: -1, upper: 1, torque: 22, amp: 0.2, phase: phase + 1.2 }))
  }
  leg(-0.82, 2.2)
  leg(-0.58, 5.1)
  leg(0.58, 5.1)
  leg(0.82, 2.2)
  return finish('trestle', 'Four legs, all arguing with each other.', 0, 0.8, segments)
}

function pogo() {
  reset()
  const { slate, ink } = PIGMENTS
  const segments = [body('circle', 0.52, 0.52, slate, { density: 13 })]
  segments.push(limb(0, 'capsule', 0.46, 0.15, slate, { pa: [0, -0.92], rest: -Math.PI / 2 - 0.3, lower: -1.2, upper: 1.2, torque: 70, speed: 12, amp: 0.3, phase: 3 }))
  segments.push(limb(1, 'capsule', 0.46, 0.12, slate, { pa: [0.85, 0], rest: 0.6, lower: -1.6, upper: 1, torque: 70, speed: 12, amp: 0.45, phase: 1 }))
  segments.push(limb(2, 'capsule', 0.62, 0.09, ink, { pa: [0.85, 0], ca: [-0.12, 0], rest: Math.PI / 2 - 0.3, lower: -0.7, upper: 0.7, torque: 40, amp: 0.15, phase: 2 }))
  return finish('pogo', 'One leg and considerable optimism.', 0, 1.4, segments)
}

function inchworm() {
  reset()
  const { plum, clay } = PIGMENTS
  const segments = [body('capsule', 0.42, 0.22, plum)]
  for (let i = 1; i < 7; i++) {
    segments.push(limb(i - 1, 'capsule', 0.42, 0.22 - i * 0.012, i % 2 ? clay : plum, { pa: [0.72, 0], ca: [-0.72, 0], rest: 0, lower: -0.95, upper: 0.95, torque: 24, amp: 0.3, phase: i * 0.7 }))
  }
  return finish('inchworm', 'A long body with no plan for it.', 0, 0.8, segments)
}

function lopsided() {
  reset()
  const { clay, ochre, ink, mist } = PIGMENTS
  const segments = [body('box', 0.86, 0.46, clay, { density: 9 })]
  segments.push(limb(0, 'capsule', 0.82, 0.16, clay, { pa: [-0.75, -0.85], rest: -Math.PI / 2 - 0.2, lower: -1.1, upper: 1.1, torque: 55, speed: 9, amp: 0.3, phase: 0 }))
  segments.push(limb(1, 'circle', 0.2, 0.2, ink, { pa: [0.9, 0], ca: [0, 0], rest: 0, lower: -0.9, upper: 0.9, torque: 12, amp: 0.1, phase: 1 }))
  segments.push(limb(0, 'capsule', 0.34, 0.11, ochre, { pa: [0.7, -0.85], rest: -Math.PI / 2 + 0.4, lower: -1.2, upper: 1.2, torque: 25, amp: 0.35, phase: 2 }))
  segments.push(limb(0, 'capsule', 0.62, 0.09, mist, { pa: [-0.9, 0.8], rest: 2.3, lower: -0.9, upper: 0.9, torque: 14, amp: 0.3, phase: 2.5 }))
  segments.push(limb(4, 'capsule', 0.34, 0.07, mist, { pa: [0.85, 0], rest: -0.5, lower: -1, upper: 1, torque: 8, amp: 0.3, phase: 3.5 }))
  return finish('lopsided', 'A long leg, a short leg and a tail.', 0, 1, segments)
}

export const RANDOM_PRESET_SEED = 20261106

export function strayCreature(seed = RANDOM_PRESET_SEED) {
  const genome = generateCreature(new Rng(seed), 'moderate')
  genome.name = 'stray'
  genome.tagline = 'Generated at random. Nobody designed this.'
  return genome
}

export function createPresets() {
  return [strider(), trestle(), pogo(), inchworm(), lopsided(), strayCreature()]
}

export function getPreset(name) {
  return createPresets().find((genome) => genome.name === name) ?? null
}
