// Records the same genome in the browser's workers and compares it with a value computed
// in Node by the same source. A match across V8, SpiderMonkey and JavaScriptCore is the
// evidence behind the claim that a shared creature behaves the same everywhere.
import { expect, test } from '@playwright/test'
import { simulateCreature } from '../../src/physics/SimulationStepper.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { EVOLVED_EXAMPLES } from '../../src/creatures/evolvedExamples.js'

const CASES = [
  { name: 'trestle', env: { id: 'flat', seed: 7 } },
  { name: 'strider', env: { id: 'hills', seed: 3 } },
  { name: 'synapse', env: { id: 'flat', seed: 7 } },
  { name: 'bounder', env: { id: 'mixed', seed: 5 } },
]

test('workers reproduce the reference physics exactly', async ({ page, browserName }) => {
  await page.goto('/?debug')
  await page.waitForFunction(() => window.__evolve?.recordRun)
  const all = [...createPresets(), ...EVOLVED_EXAMPLES]
  for (const { name, env } of CASES) {
    const genome = all.find((item) => item.name === name)
    const reference = simulateCreature(genome, env, { duration: 12 }).metrics
    const measured = await page.evaluate(async ({ genome, env }) => {
      const { recordRun, getPool } = window.__evolve
      const run = await recordRun(genome, env, getPool(), { duration: 12 })
      return { stateHash: run.metrics.stateHash, distance: run.metrics.distance, energy: run.metrics.energy }
    }, { genome, env })
    expect(measured.stateHash, `${name} on ${env.id} in ${browserName}`).toBe(reference.stateHash)
    expect(measured.distance).toBe(reference.distance)
    expect(measured.energy).toBe(reference.energy)
  }
})
