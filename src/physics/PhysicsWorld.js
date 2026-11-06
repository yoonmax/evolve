// The one place that creates a planck world. deterministicMath must be imported first.
import './deterministicMath.js'
import { Chain, Edge, Vec2, World } from 'planck'
import { terrainFor } from './Terrain.js'
import { resolveEnvironment } from './Environments.js'

export function createPhysicsWorld(envConfig) {
  const env = resolveEnvironment(envConfig)
  const terrain = terrainFor(envConfig)
  const world = new World({ gravity: new Vec2(0, -env.gravity), allowSleep: false })
  const ground = world.createBody()
  for (const piece of terrain.pieces) {
    const vertices = piece.xs.map((x, i) => new Vec2(x, piece.ys[i]))
    ground.createFixture({ shape: new Chain(vertices, false), friction: piece.friction, restitution: 0 })
  }
  // Walls at the far ends, so that nothing can leave the simulated domain.
  const leftY = terrain.ys[0]
  const rightY = terrain.ys[terrain.ys.length - 1]
  ground.createFixture({ shape: new Edge(new Vec2(terrain.xMin, leftY), new Vec2(terrain.xMin, leftY + 200)), friction: 0.5 })
  ground.createFixture({ shape: new Edge(new Vec2(terrain.xMax, rightY), new Vec2(terrain.xMax, rightY + 200)), friction: 0.5 })
  return { world, ground, env, terrain }
}
