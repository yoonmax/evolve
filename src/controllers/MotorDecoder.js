// Maps normalised network outputs to joint target angles. The low-pass filter stops a
// network from dithering its motors to exploit the solver: commands cannot change
// faster than a muscle-like 80 ms time constant, whatever the weights say.
const SMOOTHING = 0.2

export class MotorDecoder {
  constructor(genome) {
    this.joints = genome.segments.slice(1).map((segment) => segment.joint)
    this.previous = new Float64Array(this.joints.length)
  }

  decode(outputs, targets) {
    for (let i = 0; i < this.joints.length; i++) {
      const joint = this.joints[i]
      const mid = (joint.upper + joint.lower) / 2
      const half = (joint.upper - joint.lower) / 2
      const desired = mid + half * outputs[i]
      const value = this.previous[i] + SMOOTHING * (desired - this.previous[i])
      this.previous[i] = value
      targets[i] = value
    }
    return targets
  }
}
