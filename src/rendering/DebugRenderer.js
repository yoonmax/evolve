// Overlays built only from recorded solver data: collision outlines, joint anchors, motor
// torque, centre of mass, contact points and contact forces.
import { frameAt, poseAt } from './Track.js'

const pose = { x: 0, y: 0, angle: 0 }
const frame = { a: 0, b: 0, t: 0 }
const FORCE_SCALE = 0.006 // metres drawn per newton

export function drawDebug(ctx, track, art, time, camera, dpr, theme, options) {
  const r = track.recording
  frameAt(track, time, frame)
  const { k, ox, oy } = viewOf(camera, dpr)

  if (options.shapes) {
    ctx.lineWidth = 1.25 * dpr / k
    for (let i = 0; i < r.bodyCount; i++) {
      poseAt(track, i, frame, pose)
      const cos = Math.cos(pose.angle)
      const sin = Math.sin(pose.angle)
      ctx.setTransform(k * cos, -k * sin, -k * sin, -k * cos, ox + pose.x * k, oy - pose.y * k)
      ctx.strokeStyle = theme.debug
      ctx.stroke(art.pieces[i].path)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  for (let i = 1; i < r.bodyCount; i++) {
    poseAt(track, i, frame, pose)
    const local = track.jointLocal[i].child
    const cos = Math.cos(pose.angle)
    const sin = Math.sin(pose.angle)
    const wx = pose.x + local.x * cos - local.y * sin
    const wy = pose.y + local.x * sin + local.y * cos
    const sx = camera.toScreenX(wx) * dpr
    const sy = camera.toScreenY(wy) * dpr
    if (options.joints) {
      ctx.strokeStyle = theme.debug
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      ctx.moveTo(sx - 4 * dpr, sy)
      ctx.lineTo(sx + 4 * dpr, sy)
      ctx.moveTo(sx, sy - 4 * dpr)
      ctx.lineTo(sx, sy + 4 * dpr)
      ctx.stroke()
    }
    if (options.motors && r.detail) {
      const torque = r.torques[frame.a * r.jointCount + i - 1]
      const limit = track.genome.segments[i].joint.maxTorque
      const activation = Math.min(1, Math.abs(torque) / limit)
      if (activation > 0.01) {
        ctx.strokeStyle = torque > 0 ? theme.motorPlus : theme.motorMinus
        ctx.lineWidth = 2 * dpr
        ctx.beginPath()
        ctx.arc(sx, sy, 10 * dpr, -Math.PI / 2, -Math.PI / 2 + activation * Math.PI * 2 * Math.sign(torque), torque < 0)
        ctx.stroke()
      }
    }
  }

  if (options.contacts && r.detail) {
    const a = frame.a * r.maxPoints * 4
    for (let c = 0; c < r.maxPoints; c++) {
      const offset = a + c * 4
      const wx = r.points[offset]
      if (Number.isNaN(wx)) break
      const wy = r.points[offset + 1]
      const fx = r.points[offset + 2]
      const fy = r.points[offset + 3]
      const sx = camera.toScreenX(wx) * dpr
      const sy = camera.toScreenY(wy) * dpr
      ctx.fillStyle = theme.contact
      ctx.beginPath()
      ctx.arc(sx, sy, 3 * dpr, 0, Math.PI * 2)
      ctx.fill()
      if (options.forces) {
        ctx.strokeStyle = theme.contact
        ctx.lineWidth = 1.25 * dpr
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + fx * FORCE_SCALE * camera.zoom * dpr, sy - fy * FORCE_SCALE * camera.zoom * dpr)
        ctx.stroke()
      }
    }
  }

  if (options.com) {
    const cx = r.com[frame.a * 2] + (r.com[frame.b * 2] - r.com[frame.a * 2]) * frame.t
    const cy = r.com[frame.a * 2 + 1] + (r.com[frame.b * 2 + 1] - r.com[frame.a * 2 + 1]) * frame.t
    const sx = camera.toScreenX(cx) * dpr
    const sy = camera.toScreenY(cy) * dpr
    ctx.strokeStyle = theme.ink
    ctx.fillStyle = theme.paper
    ctx.lineWidth = 1.25 * dpr
    ctx.beginPath()
    ctx.arc(sx, sy, 6 * dpr, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = theme.ink
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.arc(sx, sy, 6 * dpr, 0, Math.PI / 2)
    ctx.closePath()
    ctx.moveTo(sx, sy)
    ctx.arc(sx, sy, 6 * dpr, Math.PI, Math.PI * 1.5)
    ctx.closePath()
    ctx.fill()
  }
}

export function viewOf(camera, dpr) {
  const k = camera.zoom * dpr
  const ox = camera.toScreenX(0) * dpr
  const oy = camera.toScreenY(0) * dpr
  return { k, ox, oy, dpr }
}
