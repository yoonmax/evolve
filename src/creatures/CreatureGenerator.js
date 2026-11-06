// Random organisms: always a valid rooted tree, always within computational limits.
import { BOUNDS, HARMONICS, SCHEMA_VERSION } from './Genome.js'
import { repairGenome, validateGenome } from './GenomeValidator.js'
import { MAX_SEGMENTS } from '../physics/constants.js'

const PALETTES = [
  ['#C8983F', '#3A3D42', '#E2C98F'],
  ['#6F8F5A', '#3A3D42', '#B6C49A'],
  ['#4F7290', '#26394A', '#A0B8C8'],
  ['#8C5C7E', '#46304A', '#C7A9BC'],
  ['#A9796A', '#4A332B', '#D6BCAF'],
  ['#8FA3A3', '#3F4D4D', '#C5D1CC'],
]

export const COMPLEXITY = {
  simple: { limbs: [1, 2], depth: [1, 2], maxSegments: 5 },
  moderate: { limbs: [2, 4], depth: [1, 2], maxSegments: 9 },
  complex: { limbs: [3, 5], depth: [2, 3], maxSegments: Math.min(14, MAX_SEGMENTS) },
}

const NAME_START = ['bram', 'dor', 'fen', 'gli', 'hob', 'jun', 'kel', 'lum', 'mor', 'nib', 'orr', 'pim', 'quil', 'rul', 'sko', 'tam', 'vel', 'wim', 'yar', 'zo']
const NAME_END = ['ble', 'bit', 'dle', 'kin', 'let', 'lop', 'mus', 'nix', 'pod', 'rig', 'sy', 'tle', 'wort', 'zle']

export function randomName(rng) {
  return `${rng.pick(NAME_START)}${rng.pick(NAME_END)}`
}

export function generateCreature(rng, complexity = 'moderate') {
  const profile = COMPLEXITY[complexity] ?? COMPLEXITY.moderate
  for (let attempt = 0; attempt < 8; attempt++) {
    const genome = build(rng, profile)
    if (validateGenome(genome).length === 0) return genome
  }
  throw new Error('Could not generate a valid creature.')
}

function build(rng, profile) {
  const palette = rng.pick(PALETTES)
  const shape = rng.pick(['capsule', 'capsule', 'box', 'circle'])
  const w = shape === 'circle' ? rng.range(0.36, 0.7) : rng.range(0.5, 1.2)
  const h = shape === 'circle' ? w : rng.range(0.2, 0.42)
  const segments = [{
    id: 's0', shape, w, h, density: rng.range(7, 16), friction: rng.range(0.6, 1.1), restitution: rng.range(0, 0.12),
    color: palette[0], parent: null, joint: null,
  }]
  const limbCount = rng.int(profile.limbs[1] - profile.limbs[0] + 1) + profile.limbs[0]
  const mirrored = rng.bool(0.5)
  const addLimb = (u, v, baseRest, jointPhase) => {
    const depth = rng.int(profile.depth[1] - profile.depth[0] + 1) + profile.depth[0]
    let parent = 0
    let anchorParent = { u, v }
    let rest = baseRest
    for (let d = 0; d < depth && segments.length < profile.maxSegments; d++) {
      const last = d === depth - 1
      const childShape = last && rng.bool(0.15) ? 'circle' : 'capsule'
      const childW = childShape === 'circle' ? rng.range(0.14, 0.26) : rng.range(0.24, 0.62) * (last ? 0.85 : 1)
      const childH = childShape === 'circle' ? childW : rng.range(0.08, 0.17)
      const index = segments.length
      segments.push({
        id: `s${index}`, shape: childShape, w: childW, h: childH, density: rng.range(8, 16), friction: rng.range(0.7, 1.2),
        restitution: rng.range(0, 0.1), color: last ? palette[1] : rng.pick(palette), parent,
        joint: {
          anchorParent, anchorChild: childShape === 'circle' ? { u: 0, v: 0 } : { u: -0.85, v: 0 }, rest,
          lower: rng.range(-1.3, -0.4), upper: rng.range(0.4, 1.3), maxTorque: rng.range(14, 50), maxSpeed: rng.range(6, 11),
          damping: rng.range(0.05, 0.4), gain: rng.range(6, 12),
          osc: { amp: rng.range(0.1, 0.5), phase: jointPhase + d * rng.range(0.3, 1.8), offset: rng.range(-0.15, 0.15), harmonic: rng.pick(HARMONICS), dir: rng.bool(0.8) ? 1 : -1 },
        },
      })
      parent = index
      anchorParent = { u: 0.85, v: 0 }
      rest = rng.range(-0.8, 0.8)
    }
  }
  for (let i = 0; i < limbCount; i++) {
    const across = limbCount === 1 ? 0 : (i / (limbCount - 1)) * 1.7 - 0.85
    const u = across + rng.range(-0.08, 0.08)
    const below = rng.bool(0.82)
    const rest = (below ? -Math.PI / 2 : Math.PI / 2) + rng.range(-0.5, 0.5)
    const phase = rng.range(BOUNDS.phase[0], BOUNDS.phase[1])
    addLimb(u, below ? -0.85 : 0.85, rest, phase)
    if (mirrored && i < limbCount - 1 && Math.abs(u) > 0.15) addLimb(-u, below ? -0.85 : 0.85, -rest - Math.PI, phase + Math.PI)
  }
  return repairGenome({
    schema: SCHEMA_VERSION, name: randomName(rng), rootAngle: 0, segments,
    controller: { type: 'oscillator', frequency: rng.range(0.5, 1.8), neural: null },
  })
}
