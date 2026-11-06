// Dev helper: drive the app in a real browser, take screenshots, print state.
// node scripts/shot.mjs <out.png> [--url=] [--wait=ms] [--click=testid] [--w=] [--h=] [--dark] [--js=expr]
import { chromium } from '@playwright/test'
const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? 'shot.png'
const opt = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback }
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: Number(opt('w', 1440)), height: Number(opt('h', 860)) }, colorScheme: args.includes('--dark') ? 'dark' : 'light' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
await page.goto(opt('url', 'http://localhost:5240/?debug'))
await page.waitForTimeout(Number(opt('wait', 2000)))
for (const step of args.filter((a) => a.startsWith('--click='))) {
  await page.getByTestId(step.slice(8)).click()
  await page.waitForTimeout(Number(opt('after', 1500)))
}
const js = opt('js')
if (js) console.log(JSON.stringify(await page.evaluate(js)))
await page.screenshot({ path: out })
await browser.close()
