// Regenerates the README's images and the social card from the running application.
// Every frame is the real app showing a real run. node scripts/capture-media.mjs
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc

const base = process.env.URL ?? 'http://localhost:5241/?debug'
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, colorScheme: 'light' })
page.on('pageerror', (error) => console.log('PAGEERROR', error.message))
await page.goto(base)
await page.waitForTimeout(2600)
await page.screenshot({ path: 'docs/intro.png' })

const evolve = async (generations) => {
  await page.getByTestId('start-evolution').click()
  await page.evaluate(() => {
    const sim = window.__evolve.useSim.getState()
    sim.setMode('fast')
  })
  await page.waitForFunction((n) => window.__evolve.useSim.getState().session?.history.length >= n, generations, { timeout: 120000, polling: 200 })
  await page.getByTestId('stop').click()
  await page.waitForTimeout(800)
}

await evolve(40)
await page.evaluate(() => {
  const sim = window.__evolve.useSim.getState()
  sim.setMode('watch')
  sim.setSpeed(1)
  return sim.backToLive()
})
await page.waitForTimeout(2300)
await page.screenshot({ path: 'docs/evolution.png' })
await page.screenshot({ path: 'public/og.png', clip: { x: 0, y: 40, width: 1200, height: 630 } })

await page.evaluate(() => { location.hash = '#/evolve' })
await page.waitForTimeout(1500)
await page.evaluate(() => document.querySelector('[data-testid="evolve-stats"]').scrollIntoView({ block: 'start' }))
await page.waitForTimeout(500)
await page.screenshot({ path: 'docs/charts.png' })

// Side by side: the first generation's best against the last's, at real speed.
await page.evaluate(() => document.querySelector('[data-testid="compare-stage"]').scrollIntoView({ block: 'center' }))
await page.waitForTimeout(1200)
await page.screenshot({ path: 'docs/compare.png' })
const stage = page.getByTestId('compare-stage')
await page.evaluate(() => {
  const range = document.querySelector('[data-testid="compare-stage"]').parentElement.querySelector('[data-testid="replay-reset"]')
  range.click()
})
const box = await stage.boundingBox()
const width = 760
const height = Math.round((box.height / box.width) * width)
const gifPage = await browser.newPage({ viewport: { width, height } })
const encoder = GIFEncoder()
const frames = 66
for (let i = 0; i < frames; i++) {
  const shot = await stage.screenshot({ type: 'png' })
  const rgba = await gifPage.evaluate(async ({ data, width, height }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0, width, height)
    return Array.from(ctx.getImageData(0, 0, width, height).data)
  }, { data: shot.toString('base64'), width, height })
  const pixels = Uint8ClampedArray.from(rgba)
  const palette = quantize(pixels, 64)
  encoder.writeFrame(applyPalette(pixels, palette), width, height, { palette, delay: 90 })
}
encoder.finish()
writeFileSync('docs/compare.gif', encoder.bytes())

await page.evaluate(() => { location.hash = '#/create' })
await page.waitForTimeout(800)
await page.evaluate(() => {
  const { useEditor, createPresets } = window.__evolve
  useEditor.getState().load(createPresets()[0])
})
await page.getByTestId('seg-1').click()
await page.getByTestId('test-run').click()
await page.waitForTimeout(2200)
await page.screenshot({ path: 'docs/create.png' })

await page.evaluate(() => { location.hash = '#/compete' })
await page.waitForTimeout(800)
for (const racer of ['example:galloper', 'example:bounder', 'example:looper', 'preset:trestle']) await page.getByTestId(`racer-${racer}`).click()
await page.getByTestId('start-race').click()
await page.waitForTimeout(5400)
await page.screenshot({ path: 'docs/race.png' })

const dark = await browser.newPage({ viewport: { width: 1440, height: 860 }, colorScheme: 'dark' })
await dark.goto(base)
await dark.waitForTimeout(2600)
await dark.screenshot({ path: 'docs/dark.png' })
await browser.close()
