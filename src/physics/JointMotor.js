// Motors are velocity servos with a torque ceiling: a proportional controller on angle
// error commands a speed, and the solver applies whatever torque that takes, up to the
// joint's maximum. Damping is a real opposing torque on both connected bodies.
export function commandMotor(joint, definition, targetAngle) {
  const error = targetAngle - joint.getJointAngle()
  const raw = definition.gain * error
  const speed = raw > definition.maxSpeed ? definition.maxSpeed : raw < -definition.maxSpeed ? -definition.maxSpeed : raw
  joint.setMotorSpeed(speed)
}

export function applyJointDamping(joint, definition, relativeSpeed) {
  if (definition.damping <= 0) return
  const torque = -definition.damping * relativeSpeed
  joint.getBodyB().applyTorque(torque)
  joint.getBodyA().applyTorque(-torque)
}
