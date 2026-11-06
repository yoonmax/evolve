// targetAngle = offset + direction * amplitude * sin(2π * frequency * harmonic * t + phase)
// The output is a target for a torque-limited motor; bodies are never positioned directly.
import { TAU, clamp } from '../lib/math.js'

export class OscillatorController {
  constructor(genome) {
    this.frequency = genome.controller.frequency
    this.joints = genome.segments.slice(1).map((segment) => segment.joint)
  }

  update(t, _state, targets) {
    const omega = TAU * this.frequency
    for (let i = 0; i < this.joints.length; i++) {
      const joint = this.joints[i]
      const osc = joint.osc
      const value = osc.offset + osc.dir * osc.amp * Math.sin(omega * osc.harmonic * t + osc.phase)
      targets[i] = clamp(value, joint.lower, joint.upper)
    }
    return targets
  }
}
