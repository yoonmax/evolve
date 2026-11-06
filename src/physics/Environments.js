// Catalogue of physical worlds. Each is plain data; Terrain.js turns it into geometry.

export const ENVIRONMENTS = [
  { id: 'flat', name: 'flat ground', terrain: 'flat', gravity: 9.81, friction: 0.9, note: 'The plain benchmark: nothing to climb, nothing to slip on.' },
  { id: 'hills', name: 'uneven terrain', terrain: 'hills', gravity: 9.81, friction: 0.9, note: 'Rolling bumps and slopes that punish a rigid gait.' },
  { id: 'obstacles', name: 'obstacles', terrain: 'obstacles', gravity: 9.81, friction: 0.9, note: 'Low walls and shallow gaps. Short legs catch; long legs step over.' },
  { id: 'uphill', name: 'uphill climb', terrain: 'uphill', gravity: 9.81, friction: 0.9, note: 'A rising slope. Every metre gained is paid for against gravity.' },
  { id: 'ice', name: 'slippery surface', terrain: 'flat', gravity: 9.81, friction: 0.03, note: 'Very low friction. Pushing backwards barely helps.' },
  { id: 'mixed', name: 'mixed terrain', terrain: 'mixed', gravity: 9.81, friction: 0.9, note: 'Flat, bumps, ice, a ramp and steps in sequence.' },
  { id: 'stairs', name: 'stairs', terrain: 'stairs', gravity: 9.81, friction: 0.9, note: 'A staircase of even steps.' },
  { id: 'moon', name: 'low-gravity moon', terrain: 'hills', gravity: 1.62, friction: 0.7, note: 'One sixth of Earth gravity. Bouncing becomes a strategy.' },
  { id: 'heavy', name: 'high-gravity world', terrain: 'flat', gravity: 24.8, friction: 0.9, note: 'Jupiter-strength gravity. Weak motors cannot lift the body.' },
]

export const DEFAULT_ENV = Object.freeze({ id: 'flat', seed: 7 })

export function getEnvironment(id) {
  return ENVIRONMENTS.find((env) => env.id === id) ?? ENVIRONMENTS[0]
}

/** Resolves {id, seed, gravity?} into a complete environment description. */
export function resolveEnvironment(config = DEFAULT_ENV) {
  const base = getEnvironment(config.id)
  return {
    ...base,
    seed: config.seed ?? DEFAULT_ENV.seed,
    gravity: config.gravity ?? base.gravity,
    friction: config.friction ?? base.friction,
  }
}

export function environmentKey(config) {
  const env = resolveEnvironment(config)
  return `${env.id}:${env.seed}:${env.gravity}:${env.friction}`
}
