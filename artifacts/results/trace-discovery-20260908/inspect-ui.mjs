/** Dated read-only inspection of Phoenix's trace presentation. */
import { chromium } from '../../../node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ executablePath: '/home/andrea/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  page.on('requestfailed', request => console.log('REQUEST FAILED', request.url(), request.failure()))
  await page.goto('http://127.0.0.1:6006/projects/UHJvamVjdDozNg==?timeRangeKey=7d', { waitUntil: 'networkidle' })
  await page.locator('a[href*="/spans/9fe672b86ab4fbd0d77862bcf7fea18d"]').click()
  await page.waitForFunction(() => document.body.innerText.includes('invoke_workflow'), { timeout: 10000 }).catch(error => console.log('NO UI TEXT', error.message))
  const handle = await page.getByRole('separator', { name: 'Resize drawer' }).boundingBox()
  if (handle) {
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(280, handle.y + handle.height / 2, { steps: 10 })
    await page.mouse.up()
  }
  await page.getByRole('progressbar', { name: 'loading' }).waitFor({ state: 'hidden', timeout: 10000 })
  console.log(await page.locator('body').ariaSnapshot())
  console.log(JSON.stringify(await page.locator('button').evaluateAll(nodes => nodes.map(n => ({text:n.innerText,title:n.title,label:n.getAttribute('aria-label')})))))
  console.log(JSON.stringify(await page.locator('a').evaluateAll(nodes => nodes.map(n => ({ text: n.innerText, href: n.getAttribute('href') })))) )
  await page.screenshot({ path: new URL('./phoenix-workflow-tree.png', import.meta.url).pathname })
} finally { await browser.close() }
