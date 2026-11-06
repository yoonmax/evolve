// Compares candidate 2D engines on the same task: a motor-driven 7-body walker
// on flat ground, stepped 900 times at 60 Hz. Reports speed, joint error, and
// whether two identical runs produce bit-identical states.
import { createHash } from 'node:crypto'

const STEPS = 900, RUNS = 60, DT = 1 / 60
const hash = (arr) => createHash('sha1').update(Buffer.from(new Float64Array(arr).buffer)).digest('hex').slice(0, 10)
const bodies = [
  // [x, y, halfW, halfH, parent, anchorX, anchorY]
  [0, 1.1, 0.5, 0.15, -1],
  [-0.35, 0.8, 0.07, 0.25, 0, -0.35, 1.05], [-0.35, 0.35, 0.06, 0.22, 1, -0.35, 0.57],
  [0.35, 0.8, 0.07, 0.25, 0, 0.35, 1.05], [0.35, 0.35, 0.06, 0.22, 3, 0.35, 0.57],
  [-0.7, 1.1, 0.2, 0.06, 0, -0.5, 1.1], [-1.05, 1.1, 0.15, 0.05, 5, -0.9, 1.1],
]
const target = (i, t) => 0.7 * Math.sin(5 * t + i * 1.3)

async function planckRun() {
  const { World, Vec2, Box, Edge, RevoluteJoint } = await import('planck')
  const world = new World({ gravity: new Vec2(0, -9.81), allowSleep: false })
  world.createBody().createFixture({ shape: new Edge(new Vec2(-100, 0), new Vec2(200, 0)), friction: 0.9 })
  const b = bodies.map(([x, y, hw, hh]) => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(x, y) })
    body.createFixture({ shape: new Box(hw, hh), density: 20, friction: 0.9, filterGroupIndex: -1 })
    return body
  })
  const joints = bodies.slice(1).map(([, , , , p, ax, ay], i) => world.createJoint(new RevoluteJoint({
    enableMotor: true, maxMotorTorque: 15, enableLimit: true, lowerAngle: -1.2, upperAngle: 1.2,
  }, b[p], b[i + 1], new Vec2(ax, ay))))
  let maxErr = 0
  for (let s = 0; s < STEPS; s++) {
    const t = s * DT
    joints.forEach((j, i) => j.setMotorSpeed(8 * (target(i, t) - j.getJointAngle())))
    world.step(DT, 8, 3)
    for (const j of joints) { const a = j.getAnchorA(), c = j.getAnchorB(); maxErr = Math.max(maxErr, Math.hypot(a.x - c.x, a.y - c.y)) }
  }
  return { maxErr, state: b.flatMap((x) => [x.getPosition().x, x.getPosition().y, x.getAngle()]) }
}

let RAPIER
async function rapierRun() {
  if (!RAPIER) { RAPIER = (await import('@dimforge/rapier2d-deterministic-compat')).default; await RAPIER.init() }
  const world = new RAPIER.World({ x: 0, y: -9.81 })
  world.timestep = DT
  world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5).setTranslation(50, -0.5).setFriction(0.9))
  const b = bodies.map(([x, y, hw, hh]) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y))
    world.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh).setDensity(20).setFriction(0.9).setCollisionGroups(0x00020001), body)
    return body
  })
  const joints = bodies.slice(1).map(([, , , , p, ax, ay], i) => {
    const pa = b[p].translation(), pb = b[i + 1].translation()
    const data = RAPIER.JointData.revolute({ x: ax - pa.x, y: ay - pa.y }, { x: ax - pb.x, y: ay - pb.y })
    const j = world.createImpulseJoint(data, b[p], b[i + 1], true)
    j.setLimits(-1.2, 1.2)
    return j
  })
  let maxErr = 0
  for (let s = 0; s < STEPS; s++) {
    const t = s * DT
    joints.forEach((j, i) => { const rel = b[i + 1].rotation() - b[bodies[i + 1][4]].rotation(); j.configureMotorVelocity(8 * (target(i, t) - rel), 40) })
    world.step()
    bodies.slice(1).forEach(([, , , , p, ax, ay], i) => {
      const A = b[p], B = b[i + 1], d = bodies[p], e = bodies[i + 1]
      const wa = (body, lx, ly) => { const r = body.rotation(), q = body.translation(); return [q.x + lx * Math.cos(r) - ly * Math.sin(r), q.y + lx * Math.sin(r) + ly * Math.cos(r)] }
      const a = wa(A, ax - d[0], ay - d[1]), c = wa(B, ax - e[0], ay - e[1])
      maxErr = Math.max(maxErr, Math.hypot(a[0] - c[0], a[1] - c[1]))
    })
  }
  const state = b.flatMap((x) => [x.translation().x, x.translation().y, x.rotation()])
  world.free()
  return { maxErr, state }
}

async function matterRun() {
  const M = (await import('matter-js')).default
  const engine = M.Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } })
  const S = 50
  const ground = M.Bodies.rectangle(50 * S, 25, 400 * S, 50, { isStatic: true, friction: 0.9 })
  const b = bodies.map(([x, y, hw, hh]) => M.Bodies.rectangle(x * S, -y * S, hw * 2 * S, hh * 2 * S, { friction: 0.9, density: 0.008, collisionFilter: { group: -1 } }))
  M.Composite.add(engine.world, [ground, ...b])
  const cons = bodies.slice(1).map(([x, y, , , p, ax, ay], i) => {
    const A = b[p], B = b[i + 1]
    const c = M.Constraint.create({ bodyA: A, bodyB: B, pointA: { x: ax * S - A.position.x, y: -ay * S - A.position.y }, pointB: { x: ax * S - B.position.x, y: -ay * S - B.position.y }, length: 0, stiffness: 1 })
    M.Composite.add(engine.world, c); return c
  })
  let maxErr = 0
  for (let s = 0; s < STEPS; s++) {
    const t = s * DT
    cons.forEach((c, i) => { // matter has no motor: an angular velocity servo is all that's available
      const rel = c.bodyB.angle - c.bodyA.angle
      M.Body.setAngularVelocity(c.bodyB, 0.1 * (target(i, t) - rel))
    })
    M.Engine.update(engine, DT * 1000)
    for (const c of cons) {
      const a = M.Constraint.pointAWorld(c), e = M.Constraint.pointBWorld(c)
      maxErr = Math.max(maxErr, Math.hypot(a.x - e.x, a.y - e.y) / S)
    }
  }
  return { maxErr, state: b.flatMap((x) => [x.position.x, x.position.y, x.angle]) }
}

for (const [name, run] of [['planck', planckRun], ['rapier2d-deterministic', rapierRun], ['matter-js', matterRun]]) {
  try {
    const first = await run(), second = await run()
    const t0 = performance.now()
    let worst = 0
    for (let i = 0; i < RUNS; i++) worst = Math.max(worst, (await run()).maxErr)
    const ms = performance.now() - t0
    console.log(name.padEnd(24), `${(ms / RUNS).toFixed(1)} ms/creature-eval`.padEnd(24), `${((ms / RUNS / STEPS) * 1000).toFixed(1)} us/step`.padEnd(14),
      `joint err max ${worst.toExponential(2)} m`.padEnd(30), `repeatable ${hash(first.state) === hash(second.state)}`,
      `final x ${first.state[0].toFixed(3)} finite ${first.state.every(Number.isFinite)}`)
  } catch (e) { console.log(name, 'FAILED', e.message) }
}
