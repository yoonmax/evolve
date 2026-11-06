// Evolves a creature in the real app, then lays frames of its champion out as a contact
// sheet. Numbers cannot show whether a gait is a gait; this can.
// node scripts/filmstrip.mjs <out.png> <creature> <generations> [env] [controller]
import { chromium } from '@playwright/test'
const [out, name = 'strider', gens = '40', env = 'flat', controller = 'oscillator'] = process.argv.slice(2)
const url = process.env.URL ?? 'http://localhost:5240/?debug'
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1200, height: 620 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForTimeout(1200)
await page.evaluate(({ name, env, controller }) => {
  const sim = window.__evolve.useSim.getState()
  const creature = sim.cast.find((c) => c.name === name)
  sim.selectAncestor(creature)
  sim.updateConfig({ env: { id: env, seed: 7 }, controller })
  sim.setMode('fast')
  sim.startEvolution()
}, { name, env, controller })
const t0 = Date.now()
await page.waitForFunction((g) => window.__evolve.useSim.getState().session?.history.length >= g, Number(gens), { timeout: 240000, polling: 300 })
const seconds = (Date.now() - t0) / 1000
const info = await page.evaluate(async () => {
  const store = window.__evolve.useSim
  const sim = store.getState()
  sim.stopEvolution()
  const h = sim.session.history
  const last = h[h.length - 1]
  await sim.viewGeneration(last.generation)
  { const st = store.getState(); store.setState({ scene: { ...st.scene, tracks: [st.scene.tracks[0]] } }) }
  store.getState().clock.set({ playing: false, loop: false })
  store.getState().setDebug(false)
  store.setState({ follow: 'champion' })
  const m = last.bestMetrics
  return { curve: h.filter((_, i) => i % Math.ceil(h.length / 10) === 0).map((r) => +r.championDistance.toFixed(1)), distance: m.distance, upright: m.upright, energy: m.energy, energyNorm: m.energyNorm, contact: m.contact, air: m.airTime, peak: m.peakHeight, falls: m.falls, speed: m.bestSpeed, freq: last.bestGenome.controller.frequency, mass: m.mass, div: last.diversity, invalid: h.reduce((s, r) => s + r.invalid, 0), dur: store.getState().clock.duration, ms: Math.round(h.reduce((s, r) => s + r.evaluationMs, 0) / h.length) }
})
console.log(name, env, controller, `${gens} gens in ${seconds.toFixed(0)}s`, JSON.stringify(info))
await page.waitForTimeout(600)
const shots = []
const times = [0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 7, 11]
for (const t of times) {
  await page.evaluate((t) => window.__evolve.useSim.getState().clock.seek(t), t)
  await page.waitForTimeout(900)
  await page.addStyleTag({ content: '.side-sheet,.arena-hud,.arena-note{visibility:hidden}' })
  const b = await page.screenshot({ type: 'jpeg', quality: 72, clip: { x: 300, y: 170, width: 640, height: 300 } })
  shots.push(b.toString('base64'))
}
const sheet = await browser.newPage({ viewport: { width: 1500, height: 600 } })
await sheet.setContent(`<body style="margin:0;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);gap:2px;font:12px sans-serif">${shots.map((s, i) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/jpeg;base64,${s}"><span style="position:absolute;left:4px;top:2px">${times[i]}s</span></div>`).join('')}</body>`)
await sheet.waitForTimeout(200)
await sheet.screenshot({ path: out, fullPage: true })
await browser.close()
