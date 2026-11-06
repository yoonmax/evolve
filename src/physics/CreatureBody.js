// Builds the physics instance from a phenotype: one dynamic body per segment, connected
// by torque-limited revolute joints. Collision shapes here are exactly what is drawn.
import { Box, Circle, Polygon, RevoluteJoint, Vec2 } from 'planck'
import { boxVertices } from '../creatures/GenomeDecoder.js'
import { SPAWN_CLEARANCE } from './constants.js'

const NO_SELF_COLLISION = -1 // limbs occupy parallel planes and only touch terrain

function addFixtures(body, segment) {
  const common = {
    density: segment.density,
    friction: segment.friction,
    restitution: segment.restitution,
    filterGroupIndex: NO_SELF_COLLISION,
  }
  if (segment.shape === 'circle') {
    body.createFixture({ shape: new Circle(new Vec2(0, 0), segment.w / 2), ...common })
    return
  }
  if (segment.shape === 'box') {
    const vertices = boxVertices(segment).map(([x, y]) => new Vec2(x, y))
    body.createFixture({ shape: new Polygon(vertices), ...common })
    return
  }
  // Box2D 2.x has no capsule primitive; a box plus two end circles is exactly one.
  const thick = Math.min(segment.h, segment.w)
  const half = (segment.w - thick) / 2
  if (half > 1e-3) {
    body.createFixture({ shape: new Box(half, thick / 2), ...common })
    // Each circle overlaps the box by half its area, so half density gives the true mass.
    const ends = { ...common, density: segment.density / 2 }
    body.createFixture({ shape: new Circle(new Vec2(half, 0), thick / 2), ...ends })
    body.createFixture({ shape: new Circle(new Vec2(-half, 0), thick / 2), ...ends })
  } else {
    body.createFixture({ shape: new Circle(new Vec2(0, 0), thick / 2), ...common })
  }
}

export function buildCreature(world, phenotype, terrain, spawnX = 0) {
  const baseY = terrain.heightAt(spawnX) + SPAWN_CLEARANCE
  const bodies = phenotype.parts.map((part) => {
    const body = world.createBody({
      type: 'dynamic',
      position: new Vec2(part.x + spawnX, part.y + baseY),
      angle: part.angle,
      linearDamping: 0,
      angularDamping: 0.02,
    })
    addFixtures(body, part.segment)
    return body
  })
  const joints = []
  for (let i = 1; i < phenotype.parts.length; i++) {
    const part = phenotype.parts[i]
    const definition = part.segment.joint
    const joint = world.createJoint(
      new RevoluteJoint(
        {
          enableLimit: true,
          lowerAngle: definition.lower,
          upperAngle: definition.upper,
          enableMotor: true,
          maxMotorTorque: definition.maxTorque,
          motorSpeed: 0,
          collideConnected: false,
        },
        bodies[part.segment.parent],
        bodies[i],
        new Vec2(part.anchor.x + spawnX, part.anchor.y + baseY),
      ),
    )
    joints.push(joint)
  }
  return { bodies, joints, mass: bodies.reduce((sum, body) => sum + body.getMass(), 0) }
}
