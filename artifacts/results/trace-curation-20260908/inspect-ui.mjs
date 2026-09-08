/** Visual evidence from the installed Chromium against the real local servers. */
import { chromium } from '../../../node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ executablePath: '/home/andrea/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.goto(process.env.GH_UI_URL ?? 'http://127.0.0.1:6006', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.trim().length > 30, { timeout: 20000 })
  if (process.env.GH_PROJECT_READY) await page.waitForFunction(() => /[0-9]+(?:\.[0-9]+)?(?:ms|s)/.test(document.body.innerText), { timeout: 30000 })
  if (process.env.GH_TRACE_ID) {
    const link = page.locator(`a[href*="/spans/${process.env.GH_TRACE_ID}"]`).first()
    await link.click()
    await page.waitForFunction(() => document.body.innerText.includes('invoke_workflow'), { timeout: 30000 })
    const handle = await page.getByRole('separator', { name: 'Resize drawer' }).boundingBox()
    if (handle) {
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(240, handle.y + handle.height / 2, { steps: 10 })
      await page.mouse.up()
    }
  }
  console.log(await page.locator('body').ariaSnapshot())
  await page.screenshot({ path: new URL(process.env.GH_UI_SCREENSHOT ?? './phoenix-projects.png', import.meta.url).pathname })
} finally { await browser.close() }
