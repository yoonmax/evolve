import { expect } from '@playwright/test'

/** Opens the app with the debug handle and fails the test on any page error. */
export async function open(page, hash = '') {
  const problems = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  page.problems = problems
  await page.goto(`/?debug${hash}`)
  await expect(page.locator('.wordmark')).toHaveText('evolve')
  return problems
}

export const history = (page) => page.evaluate(() => {
  const session = window.__evolve.useSim.getState().session
  return session ? session.history.map((record) => ({ generation: record.generation, best: record.bestDistance, fitness: record.bestFitness, env: record.envId })) : []
})

export async function waitForGenerations(page, count, timeout = 60000) {
  await page.waitForFunction((n) => (window.__evolve.useSim.getState().session?.history.length ?? 0) >= n, count, { timeout, polling: 100 })
}

export async function evolveFast(page, count) {
  await page.getByTestId('start-evolution').click()
  await page.evaluate(() => window.__evolve.useSim.getState().setMode('fast'))
  await waitForGenerations(page, count)
  await page.getByTestId('stop').click()
  await expect(page.getByTestId('evolve')).toBeVisible()
}

export const go = (page, route) => page.evaluate((name) => { location.hash = `#/${name}` }, route)

/** A digest of the arena's pixels, for telling whether anything is really being drawn. */
export const arenaDigest = (page) => page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="arena-canvas"]')
  const copy = document.createElement('canvas')
  copy.width = 200
  copy.height = 100
  const ctx = copy.getContext('2d')
  ctx.drawImage(canvas, 0, 0, 200, 100)
  const { data } = ctx.getImageData(0, 0, 200, 100)
  let hash = 0
  const colours = new Set()
  for (let i = 0; i < data.length; i += 4) {
    hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) | 0
    colours.add((data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3))
  }
  return { hash, colours: colours.size }
})

/** Screen position of a point in the editor's world coordinates. */
export const worldToScreen = (page, wx, wy) => page.evaluate(({ wx, wy }) => {
  const { x, y, zoom, w, h } = window.__evolve.editorView
  const rect = document.querySelector('[data-testid="editor-canvas"]').getBoundingClientRect()
  return { x: rect.left + w / 2 + (wx - x) * zoom, y: rect.top + h / 2 - (wy - y) * zoom }
}, { wx, wy })
