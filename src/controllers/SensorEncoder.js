// Turns measured physical state into the neural network's input vector. Encoding:
//   [0..1] clock           sin and cos of an evolved-frequency phase
//   [2..3] body angle      sin and cos of the root's rotation away from its rest pose
//   [4]    body spin       angular velocity / 8 rad/s, clamped to [-1, 1]
//   next J joint angles    angle mapped so that the limits are -1 and +1
//   next J joint speeds    speed / the joint's max speed, clamped to [-1, 1]
//   next C ground contact  1 when that leaf segment touches terrain, otherwise 0
export const MAX_CONTACT_SENSORS = 6

export function contactSensorSegments(genome) {
  const hasChild = new Array(genome.segments.length).fill(false)
  for (const segment of genome.segments) {
    if (segment.parent !== null && segment.parent !== undefined) hasChild[segment.parent] = true
  }
  const leaves = []
  hasChild.forEach((value, index) => {
    if (!value && index !== 0) leaves.push(index)
  })
  return leaves.slice(0, MAX_CONTACT_SENSORS)
}

export function sensorCount(genome) {
  const joints = genome.segments.length - 1
  return 5 + joints * 2 + contactSensorSegments(genome).length
}

const limit = (value) => (value < -1 ? -1 : value > 1 ? 1 : value)

export class SensorEncoder {
  constructor(genome) {
    this.joints = genome.segments.slice(1).map((segment) => segment.joint)
    this.contactSegments = contactSensorSegments(genome)
    this.rootRest = genome.rootAngle ?? 0
    this.size = sensorCount(genome)
  }

  /**
   * @param state {rootAngle, rootSpin, jointAngles, jointSpeeds, contacts}
   * @param phase clock phase in radians
   * @param out   Float64Array of this.size
   */
  encode(state, phase, out) {
    out[0] = Math.sin(phase)
    out[1] = Math.cos(phase)
    const relative = state.rootAngle - this.rootRest
    out[2] = Math.sin(relative)
    out[3] = Math.cos(relative)
    out[4] = limit(state.rootSpin / 8)
    let cursor = 5
    const count = this.joints.length
    for (let i = 0; i < count; i++) {
      const joint = this.joints[i]
      const span = joint.upper - joint.lower
      out[cursor + i] = span > 1e-6 ? limit((2 * (state.jointAngles[i] - joint.lower)) / span - 1) : 0
      out[cursor + count + i] = limit(state.jointSpeeds[i] / joint.maxSpeed)
    }
    cursor += count * 2
    for (let i = 0; i < this.contactSegments.length; i++) {
      out[cursor + i] = state.contacts[this.contactSegments[i]] ? 1 : 0
    }
    return out
  }
}
