// Measures real throughput and frame pacing in the production build. node scripts/measure.mjs
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ channel: 'chromium' })
for (const population of [30, 100]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })
  await page.goto(process.env.URL ?? 'http://localhost:5241/?debug')
  await page.waitForTimeout(1500)
  const result = await page.evaluate(async (population) => {
    const { useSim, getPool } = window.__evolve
    const sim = useSim.getState()
    sim.updateConfig({ populationSize: population })
    sim.setMode('fast')
    const gaps = []
    let last = performance.now()
    let running = true
    const tick = (now) => {
      gaps.push(now - last)
      last = now
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    sim.startEvolution()
    const started = performance.now()
    while (useSim.getState().session?.history.length < 30) await new Promise((resolve) => setTimeout(resolve, 100))
    const seconds = (performance.now() - started) / 1000
    running = false
    const session = useSim.getState().session
    useSim.getState().stopEvolution()
    gaps.sort((a, b) => a - b)
    return {
      population,
      workers: getPool().size,
      generations: session.history.length,
      seconds: +seconds.toFixed(2),
      evaluationsPerSecond: Math.round((session.evaluations / session.evaluationMs) * 1000),
      frameMedianMs: +gaps[gaps.length >> 1].toFixed(1),
      frameP99Ms: +gaps[Math.floor(gaps.length * 0.99)].toFixed(1),
      memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    }
  }, population)
  console.log(JSON.stringify(result))
  await page.close()
}
await browser.close()
