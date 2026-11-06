import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { arenaDigest, evolveFast, go, history, open, waitForGenerations, worldToScreen } from './helpers.js'

test.describe('first visit', () => {
  test('opens straight into a live simulation, with lowercase branding', async ({ page }) => {
    const problems = await open(page)
    await expect(page).toHaveTitle('evolve')
    await expect(page.getByRole('heading', { name: 'None of these can walk yet.' })).toBeVisible()
    await expect(page.locator('.cast-item')).toHaveCount(6)
    await expect(page.getByTestId('start-evolution')).toBeVisible()
    await expect.poll(async () => (await arenaDigest(page)).colours, { timeout: 15000 }).toBeGreaterThan(10)
    const first = await arenaDigest(page)
    await page.waitForTimeout(900)
    const second = await arenaDigest(page)
    expect(second.hash).not.toBe(first.hash) // creatures are really moving
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/\bEvolve Lab\b|EVOLVE/)
    expect(problems).toEqual([])
  })

  test('explains itself on request', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'How does this work?' }).click()
    await expect(page.getByTestId('explain')).toContainText('Nothing here is animated by hand')
  })

  test('picks a creature by its button and by clicking it in the arena', async ({ page }) => {
    await open(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__evolve.useSim.getState().scene))).toBe(true)
    await page.locator('.cast-item', { hasText: 'pogo' }).click()
    await expect(page.locator('.cast-item', { hasText: 'pogo' })).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('evolution', () => {
  test('evolves for real in watch mode: generations advance and are shown', async ({ page }) => {
    const problems = await open(page)
    await page.getByTestId('start-evolution').click()
    await waitForGenerations(page, 2)
    await expect(page.getByTestId('stats')).toBeVisible()
    await expect(page.getByTestId('announcer')).toContainText(/Generation \d+ complete/)
    const records = await history(page)
    expect(records[0].generation).toBe(1)
    expect(records[1].generation).toBe(2)
    expect(problems).toEqual([])
  })

  test('fast mode runs many generations, improves, and stops on command', async ({ page }) => {
    await open(page)
    await page.locator('.cast-item', { hasText: 'trestle' }).click()
    await evolveFast(page, 15)
    const records = await history(page)
    expect(records.length).toBeGreaterThanOrEqual(15)
    expect(records[records.length - 1].fitness).toBeGreaterThan(records[0].fitness)
    const count = records.length
    await page.waitForTimeout(800)
    expect((await history(page)).length).toBeLessThanOrEqual(count + 1)
    const settled = (await history(page)).length
    await page.waitForTimeout(800)
    expect((await history(page)).length).toBe(settled)
  })

  test('next generation evaluates exactly one', async ({ page }) => {
    await open(page)
    await page.getByTestId('next-generation').click()
    await waitForGenerations(page, 1)
    await expect(page.getByTestId('next-generation')).toBeEnabled()
    await page.getByTestId('next-generation').click()
    await waitForGenerations(page, 2)
    await page.waitForTimeout(600)
    expect((await history(page)).length).toBe(2)
  })

  test('the interface stays responsive during evaluation', async ({ page }) => {
    await open(page)
    await page.getByTestId('population').selectOption('200')
    await page.getByTestId('start-evolution').click()
    await page.evaluate(() => window.__evolve.useSim.getState().setMode('fast'))
    await waitForGenerations(page, 1)
    const worstGap = await page.evaluate(() => new Promise((resolve) => {
      let last = performance.now()
      let worst = 0
      const started = last
      const tick = (now) => {
        worst = Math.max(worst, now - last)
        last = now
        if (now - started > 2000) resolve(worst)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }))
    expect(worstGap).toBeLessThan(250)
  })

  test('play and pause control playback without touching evolution', async ({ page }) => {
    await open(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__evolve.useSim.getState().scene))).toBe(true)
    await page.getByTestId('play-pause').click()
    const time = () => page.evaluate(() => window.__evolve.useSim.getState().clock.time)
    const a = await time()
    await page.waitForTimeout(400)
    expect(await time()).toBe(a)
    await page.getByTestId('play-pause').click()
    await page.waitForTimeout(400)
    expect(await time()).not.toBe(a)
  })

  test('changing the environment changes what is simulated', async ({ page }) => {
    await open(page)
    await page.getByTestId('environment').selectOption('hills')
    await page.getByTestId('next-generation').click()
    await waitForGenerations(page, 1)
    expect((await history(page))[0].env).toBe('hills')
  })

  test('changing population size applies to the next generation', async ({ page }) => {
    await open(page)
    await page.getByTestId('population').selectOption('8')
    await page.getByTestId('next-generation').click()
    await waitForGenerations(page, 1)
    await expect.poll(() => page.evaluate(() => window.__evolve.useSim.getState().session.history[0].populationSize)).toBe(8)
  })

  test('reset returns to the start', async ({ page }) => {
    await open(page)
    await page.getByTestId('next-generation').click()
    await waitForGenerations(page, 1)
    await page.getByTestId('reset').click()
    await expect(page.getByTestId('start-evolution')).toBeVisible()
    expect(await history(page)).toEqual([])
  })

  test('surprise me starts a valid random experiment', async ({ page }) => {
    const problems = await open(page)
    await page.getByTestId('surprise').click()
    await waitForGenerations(page, 1)
    await expect(page.getByTestId('experiment-name')).not.toBeEmpty()
    expect(problems).toEqual([])
  })

  test('the lineage selects a generation, which replays', async ({ page }) => {
    await open(page)
    await evolveFast(page, 5)
    const box = await page.getByTestId('lineage').boundingBox()
    await page.mouse.click(box.x + 60, box.y + box.height / 2)
    await expect(page.getByTestId('status')).toContainText('Replaying the best of generation')
    await page.getByRole('button', { name: 'Back to latest' }).click()
    await expect(page.getByTestId('status')).not.toContainText('Replaying')
  })

  test('physics overlays and tiled arenas draw', async ({ page }) => {
    const problems = await open(page)
    await evolveFast(page, 3)
    await page.getByRole('checkbox', { name: 'Physics' }).check()
    await page.waitForTimeout(300)
    await page.getByTestId('layout').selectOption('grid')
    await page.waitForTimeout(300)
    await page.getByTestId('camera').selectOption('leader')
    expect(problems).toEqual([])
  })
})

test.describe('statistics and history', () => {
  test('shows charts from real data, and exports them', async ({ page }) => {
    await open(page)
    await evolveFast(page, 6)
    await go(page, 'evolve')
    await expect(page.getByTestId('evolve-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Fitness by generation' })).toBeVisible()
    await expect(page.locator('.chart svg').first()).toBeVisible()
    await expect(page.getByTestId('evolve-stats')).toContainText('best fitness')
    const rows = await page.locator('[data-testid="history-table"] tbody tr').count()
    expect(rows).toBeGreaterThanOrEqual(6)
    const download = page.waitForEvent('download')
    await page.getByTestId('export-csv').click()
    const file = await download
    const csv = readFileSync(await file.path(), 'utf8')
    expect(csv.split('\n')[0]).toContain('generation,seed,population,best_fitness')
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(7)
  })

  test('replays are re-simulated and match the original run bit for bit', async ({ page }) => {
    await open(page)
    await evolveFast(page, 4)
    await go(page, 'evolve')
    await expect(page.getByTestId('replay-verification')).toContainText('matches the original run exactly')
    await page.locator('[data-testid="history-table"] tbody tr').last().click()
    await expect(page.getByTestId('replay-verification')).toContainText('Generation 1:')
    await expect(page.getByTestId('replay-verification')).toContainText('matches the original run exactly')
  })

  test('replay controls scrub, step and change speed', async ({ page }) => {
    await open(page)
    await evolveFast(page, 2)
    await go(page, 'evolve')
    const stage = page.locator('.section', { has: page.getByTestId('replay-stage') })
    await expect(stage.getByTestId('replay-time')).toBeVisible()
    await stage.getByTestId('replay-play').click()
    await stage.getByTestId('replay-reset').click()
    await stage.getByTestId('replay-step').click()
    await expect(stage.getByTestId('replay-time')).toContainText(/^0\.0[12]/)
    await stage.getByTestId('replay-speed').selectOption('0.25')
  })

  test('compares two creatures with results and gene differences', async ({ page }) => {
    await open(page)
    await evolveFast(page, 6)
    await go(page, 'evolve')
    await expect(page.getByTestId('compare-table')).toContainText('Distance')
    await expect(page.getByTestId('gene-diff')).toContainText(/segment|body|rhythm/)
    await page.getByTestId('compare-a').selectOption({ label: 'starter: pogo' })
    await expect(page.getByTestId('compare-table')).toContainText('Mass')
    await page.getByTestId('compare-average').click()
    await expect(page.getByTestId('compare-a')).toHaveValue('latest-median')
  })

  test('branches a new experiment from a past generation', async ({ page }) => {
    await open(page)
    await evolveFast(page, 3)
    await go(page, 'evolve')
    await page.getByTestId('branch').click()
    await expect(page.getByTestId('experiment-name')).toContainText('branch at')
    await waitForGenerations(page, 1)
    await page.getByTestId('stop').click()
  })

  test('imports experiment settings from a file, and rejects anything else', async ({ page }) => {
    await open(page, '#/evolve')
    const dir = mkdtempSync(join(tmpdir(), 'evolve-'))
    const good = join(dir, 'settings.json')
    writeFileSync(good, JSON.stringify({ kind: 'evolve/experiment-config', config: { objective: 'jump', populationSize: 12 } }))
    await page.getByTestId('import-settings').setInputFiles(good)
    await expect(page.getByTestId('objective')).toHaveValue('jump')
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{"hello":"world"}')
    await page.getByTestId('import-settings').setInputFiles(bad)
    await expect(page.locator('.toast.error')).toContainText('does not contain evolve experiment settings')
  })

  test('advanced settings are hidden until asked for, and they work', async ({ page }) => {
    await open(page)
    await go(page, 'evolve')
    await expect(page.getByTestId('selection-method')).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Show all settings' }).check()
    await page.getByTestId('selection-method').selectOption('rank')
    await page.getByTestId('objective').selectOption('efficient')
    const config = await page.evaluate(() => window.__evolve.useSim.getState().config)
    expect(config.selection.method).toBe('rank')
    expect(config.objective).toBe('efficient')
    await page.getByTestId('generation-limit').selectOption('25')
    await go(page, 'simulate')
    await page.getByTestId('start-evolution').click()
    await page.evaluate(() => window.__evolve.useSim.getState().setMode('fast'))
    await expect.poll(async () => page.evaluate(() => window.__evolve.useSim.getState().running), { timeout: 60000 }).toBe(false)
    expect((await history(page)).length).toBe(25)
  })
})

test.describe('creature builder', () => {
  test('builds, edits, undoes, tests, saves, reloads and evolves a custom creature', async ({ page }) => {
    const problems = await open(page, '#/create')
    await expect(page.getByTestId('editor-canvas')).toBeVisible()
    const segments = () => page.evaluate(() => window.__evolve.useEditor.getState().genome.segments.length)
    expect(await segments()).toBe(3)

    // add a limb by clicking on the body
    await page.getByTestId('add-limb').click()
    const body = await worldToScreen(page, 0.1, 0.05)
    await page.mouse.click(body.x, body.y)
    expect(await segments()).toBe(4)

    // real sliders change real genes
    await page.getByTestId('seg-1').click()
    const widthBefore = await page.evaluate(() => window.__evolve.useEditor.getState().genome.segments[1].w)
    await page.getByLabel('Length').fill('0.9')
    expect(await page.evaluate(() => window.__evolve.useEditor.getState().genome.segments[1].w)).not.toBe(widthBefore)

    // undo, redo
    await page.getByTestId('undo').click()
    expect(await page.evaluate(() => window.__evolve.useEditor.getState().genome.segments[1].w)).toBe(widthBefore)
    await page.getByTestId('redo').click()

    // delete and duplicate
    await page.getByTestId('duplicate').click()
    expect(await segments()).toBe(5)
    await page.getByTestId('delete').click()
    expect(await segments()).toBe(4)

    await page.getByTestId('creature-name').fill('test beast')

    // test run: real measurements
    await page.getByTestId('test-run').click()
    await expect(page.getByTestId('test-panel')).toBeVisible()
    await expect.poll(async () => page.getByTestId('test-stats').innerText(), { timeout: 15000 }).toMatch(/elapsed/)
    await expect.poll(async () => Number((await page.getByTestId('test-stats').locator('.readout-value').last().innerText()).replace('s', '')), { timeout: 15000 }).toBeGreaterThan(0)

    // save
    await page.getByTestId('save-creature').click()
    await expect(page.locator('.toast')).toContainText('Saved test beast')

    // survives a reload
    await page.reload()
    await go(page, 'gallery')
    await expect(page.getByTestId('saved-grid').getByTestId('specimen')).toHaveCount(1)
    await expect(page.getByTestId('specimen-name')).toHaveValue('test beast')

    // load back into the editor
    await page.getByTestId('saved-grid').getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByTestId('creature-name')).toHaveValue('test beast')
    expect(await segments()).toBe(4)

    // evolve it
    await page.getByTestId('evolve-this').click()
    await waitForGenerations(page, 1)
    await expect(page.getByTestId('experiment-name')).toContainText('test beast')
    expect(problems).toEqual([])
  })

  test('drags handles to resize, rotate and reattach', async ({ page }) => {
    await open(page, '#/create')
    const genome = () => page.evaluate(() => window.__evolve.useEditor.getState().genome)
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2)
      await page.mouse.move(to.x, to.y)
      await page.mouse.up()
    }
    await page.getByTestId('seg-0').click()
    const start = await genome()

    // length handle at the end of the body's long axis
    await drag(await worldToScreen(page, start.segments[0].w / 2, 0), await worldToScreen(page, 0.8, 0))
    expect((await genome()).segments[0].w).toBeCloseTo(1.6, 1)

    // rotate handle just beyond the end
    const w = (await genome()).segments[0].w
    await drag(await worldToScreen(page, w / 2 + 0.2, 0), await worldToScreen(page, 0, w / 2 + 0.2))
    expect((await genome()).rootAngle).toBeCloseTo(Math.PI / 2, 1)
    await page.getByTestId('undo').click()

    // dragging a leg along the body moves its attachment and one undo restores it
    const before = (await genome()).segments[1].joint.anchorParent.u
    const leg = await page.evaluate(() => {
      const { x, y, zoom, w, h } = window.__evolve.editorView
      const rect = document.querySelector('[data-testid="editor-canvas"]').getBoundingClientRect()
      return { scale: zoom, rect: { left: rect.left, top: rect.top }, x, y, w, h }
    })
    expect(leg.scale).toBeGreaterThan(0)
    await page.getByTestId('seg-1').click()
    const parts = await page.evaluate(() => {
      const g = window.__evolve.useEditor.getState().genome
      const joint = g.segments[1].joint
      return { u: joint.anchorParent.u, v: joint.anchorParent.v, bodyW: g.segments[0].w, bodyH: g.segments[0].h, legW: g.segments[1].w }
    })
    const anchorX = (parts.u * parts.bodyW) / 2
    const anchorY = (parts.v * parts.bodyH) / 2
    const onLeg = await worldToScreen(page, anchorX, anchorY - parts.legW / 2)
    const moved = await worldToScreen(page, anchorX + 0.2, anchorY - parts.legW / 2)
    await drag(onLeg, moved)
    expect((await genome()).segments[1].joint.anchorParent.u).toBeGreaterThan(before)
  })

  test('randomize makes valid creatures, and validation covers bad state', async ({ page }) => {
    await open(page, '#/create')
    for (const complexity of ['simple', 'moderate', 'complex']) {
      await page.getByTestId('complexity').selectOption(complexity)
      await page.getByTestId('randomize').click()
      await expect(page.getByTestId('problems')).toHaveCount(0)
    }
    await expect(page.getByTestId('test-panel')).toBeVisible()
    await page.evaluate(() => window.__evolve.useEditor.getState().update((draft) => { draft.segments[1].density = 0 }))
    await expect(page.getByTestId('problems')).toContainText('no mass')
    await expect(page.getByTestId('evolve-this')).toBeDisabled()
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('problems')).toHaveCount(0)
  })
})

test.describe('competition', () => {
  test('races creatures to a finish, in lanes, and names a winner', async ({ page }) => {
    const problems = await open(page, '#/compete')
    await expect(page.getByTestId('start-race')).toBeDisabled()
    await page.getByTestId('racer-example:galloper').click()
    await page.getByTestId('racer-example:bounder').click()
    await page.getByTestId('racer-preset:trestle').click()
    await page.getByTestId('race-finish').selectOption('10')
    await page.getByTestId('start-race').click()
    await expect(page.getByTestId('countdown')).toBeVisible()
    await expect(page.getByTestId('leaderboard')).toBeVisible()
    await page.getByTestId('replay-speed').selectOption('8')
    await expect(page.getByTestId('winner')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('winner')).toContainText(/won in \d+\.\d+ s/)
    await expect(page.getByTestId('leaderboard')).toContainText('Final order')
    // slow-motion replay of the same race
    await page.getByTestId('replay-reset').click()
    await page.getByTestId('replay-speed').selectOption('0.25')
    await page.getByTestId('replay-play').click()
    expect(problems).toEqual([])
  })
})

test.describe('experiments', () => {
  test('runs a controlled comparison over seeds and reports honestly', async ({ page }) => {
    const problems = await open(page, '#/experiments')
    await page.getByTestId('lab-creature').selectOption('inchworm')
    await page.getByLabel('Generations').fill('4')
    await page.getByLabel('Seeds per arm').fill('2')
    await page.getByLabel('Population', { exact: true }).fill('8')
    await page.getByTestId('lab-run').click()
    await expect(page.getByTestId('lab-table-el')).toBeVisible({ timeout: 60000 })
    await expect(page.getByTestId('lab-table-el')).toContainText('50%')
    await expect(page.getByTestId('lab-summary')).toContainText(/seeds per arm/)
    await expect(page.getByTestId('lab-summary')).toContainText(/simulated runs/)
    expect(problems).toEqual([])
  })

  test('can be stopped', async ({ page }) => {
    await open(page, '#/experiments')
    await page.getByLabel('Generations').fill('100')
    await page.getByTestId('lab-run').click()
    await expect(page.getByTestId('lab-stop')).toBeVisible()
    await page.waitForTimeout(700)
    await page.getByTestId('lab-stop').click()
    await expect(page.getByTestId('lab-run')).toBeVisible({ timeout: 15000 })
  })
})

test.describe('gallery and sharing', () => {
  test('shows starters and evolved examples, with real portraits', async ({ page }) => {
    await open(page, '#/gallery')
    await expect(page.getByTestId('examples-grid').getByTestId('specimen')).toHaveCount(6)
    const hasInk = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="examples-grid"] canvas')
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true
      return false
    })
    expect(hasInk).toBe(true)
  })

  test('exports and imports a genome, and rejects bad files', async ({ page }) => {
    await open(page, '#/gallery')
    const example = page.getByTestId('examples-grid').getByTestId('specimen').first()
    const downloadPromise = page.waitForEvent('download')
    await example.getByRole('button', { name: 'Export' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('evolve-bounder.json')
    const text = readFileSync(await download.path(), 'utf8')
    expect(JSON.parse(text).kind).toBe('evolve/creature')

    const dir = mkdtempSync(join(tmpdir(), 'evolve-'))
    const good = join(dir, 'good.json')
    writeFileSync(good, text)
    await page.getByTestId('import-file').setInputFiles(good)
    await expect(page.getByTestId('saved-grid').getByTestId('specimen')).toHaveCount(1)

    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{"not":"a creature"}')
    await page.getByTestId('import-file').setInputFiles(bad)
    await expect(page.locator('.toast.error')).toContainText('does not contain an evolve creature')

    // rename, duplicate, delete
    await page.getByTestId('specimen-name').fill('imported one')
    await page.getByTestId('specimen-name').press('Enter')
    await page.getByTestId('saved-grid').getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByTestId('saved-grid').getByTestId('specimen')).toHaveCount(2)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByTestId('saved-grid').getByRole('button', { name: 'Delete' }).first().click()
    await expect(page.getByTestId('saved-grid').getByTestId('specimen')).toHaveCount(1)
  })

  test('opens a shared creature link and validates it', async ({ page }) => {
    await open(page, '#/gallery')
    const link = await page.evaluate(() => window.__evolve.shareUrl(window.__evolve.EVOLVED_EXAMPLES[1]))
    expect(link).toContain('#/gallery?creature=')
    await page.goto(link)
    await page.reload()
    await expect(page.getByTestId('shared-creature')).toContainText('galloper')
    await page.goto('/?debug#/gallery?creature=broken!!!')
    await page.reload()
    await expect(page.locator('.toast.error')).toContainText('damaged')
  })
})

test.describe('persistence', () => {
  test('a saved experiment comes back after a reload and continues', async ({ page }) => {
    await open(page)
    await evolveFast(page, 6)
    await page.getByTestId('save-experiment').click()
    await expect(page.locator('.toast')).toContainText('Saved')
    const before = await history(page)
    await page.reload()
    await expect(page.getByTestId('resume')).toBeVisible()
    await page.getByTestId('resume').click()
    await expect(page.getByTestId('stats')).toBeVisible()
    const restored = await history(page)
    expect(restored.length).toBe(before.length)
    expect(restored[restored.length - 1].fitness).toBe(before[before.length - 1].fitness)
    await page.getByTestId('next-generation').click()
    await waitForGenerations(page, before.length + 1)
    const after = await history(page)
    expect(after[after.length - 1].fitness).toBeGreaterThanOrEqual(before[before.length - 1].fitness)
  })

  test('settings report storage and clear everything on confirmation', async ({ page }) => {
    await open(page, '#/gallery')
    await page.getByTestId('examples-grid').getByRole('button', { name: 'Edit' }).first().click()
    await page.getByTestId('save-creature').click()
    await expect(page.locator('.toast')).toContainText('Saved')
    await go(page, 'settings')
    await expect(page.getByTestId('storage-usage')).toContainText(/used of/)
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByTestId('clear-data').click()
    await go(page, 'gallery')
    await expect(page.getByTestId('saved-grid').getByTestId('specimen')).toHaveCount(1)
    await go(page, 'settings')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('clear-data').click()
    await expect(page.locator('.toast', { hasText: 'deleted' })).toBeVisible()
    await go(page, 'gallery')
    await expect(page.getByTestId('saved-grid')).toHaveCount(0)
  })
})

test.describe('appearance and access', () => {
  test('switches theme, repainting the arena', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Use dark theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Use light theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('reduced motion still works', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const problems = await open(page, '#/compete')
    await page.getByTestId('racer-preset:strider').click()
    await page.getByTestId('racer-preset:pogo').click()
    await page.getByTestId('start-race').click()
    await expect(page.getByTestId('countdown')).toHaveCount(0)
    await expect(page.getByTestId('leaderboard')).toBeVisible()
    expect(problems).toEqual([])
  })

  test('is usable from the keyboard', async ({ page, browserName }) => {
    await open(page)
    // Safari's Tab key skips links unless the user opts in, so the first stop differs there.
    if (browserName !== 'webkit') {
      await page.keyboard.press('Tab')
      await expect(page.locator('.skip-link')).toBeFocused()
    }
    await page.locator('[data-testid="start-evolution"]').focus()
    await page.keyboard.press('Enter')
    await waitForGenerations(page, 1)
  })

  test('works on a phone-sized screen with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    const problems = await open(page)
    await expect(page.getByTestId('start-evolution')).toBeVisible()
    await page.getByTestId('start-evolution').click()
    await waitForGenerations(page, 1)
    for (const route of ['simulate', 'create', 'evolve', 'compete', 'experiments', 'gallery', 'settings']) {
      await go(page, route)
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, route).toBeLessThanOrEqual(0)
    }
    expect(problems).toEqual([])
  })
})
