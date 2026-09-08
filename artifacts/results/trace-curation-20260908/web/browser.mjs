/** Isolated browser UAT against the supported live Web profile. */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '../../../../node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const browser = await chromium.launch({ executablePath: '/home/andrea/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', headless: true })
try {
  const state = new URL('./.browser-state.json', import.meta.url).pathname
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...await readFile(state).then(() => ({ storageState: state }), () => ({})) })
  const page = await context.newPage()
  const serverLog = await readFile(new URL('./server.log', import.meta.url), 'utf8')
  const url = serverLog.match(/http:\/\/127\.0\.0\.1:3017\/\?token=\S+/)?.[0]
  if (!url) throw Error('Web bootstrap address missing')
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.length > 40, { timeout: 20000 })
  if (process.env.GH_WEB_RESUME === '1') {
    const resume = (await readFile(new URL('./last-page.txt', import.meta.url), 'utf8')).trim()
    await page.goto(resume, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.innerText.length > 40, { timeout: 20000 })
  }
  const action = process.env.GH_WEB_ACTION
  if (action) {
    const run = await import(new URL(`./${action}.mjs`, import.meta.url))
    await run.default(page)
  }
  await context.storageState({ path: state })
  await writeFile(new URL('./last-page.txt', import.meta.url), page.url().split('?')[0]+'\n')
  console.log(await page.locator('body').ariaSnapshot())
  await page.screenshot({ path: new URL(`./${action ?? 'initial'}.png`, import.meta.url).pathname })
} finally { await browser.close() }
