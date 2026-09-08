/** Read-only recording of the real Phoenix benchmark review UI; no model invocation. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from '../../../../node_modules/.pnpm/node_modules/playwright/index.mjs'

const [receiptFile, output, executablePath] = process.argv.slice(2)
if (!receiptFile || !output || !executablePath) throw Error('Expected receipt, fresh output directory, and Chromium executable')
const receipt = JSON.parse(await readFile(receiptFile, 'utf8'))
await mkdir(output, { recursive: false, mode: 0o700 })
const browser = await chromium.launch({ executablePath })
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 850 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const frames = []
  const capture = async name => {
    const file = path.join(output, `${frames.length.toString().padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path: file })
    frames.push({ file, url: page.url(), sha256: createHash('sha256').update(await readFile(file)).digest('hex') })
  }
  await page.goto(receipt.url)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await capture('overview')
  await page.getByRole('tab', { name: /^Examples / }).click()
  await page.locator('table').waitFor()
  await capture('examples')
  await page.getByRole('searchbox', { name: 'Search examples' }).fill('untrusted')
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    return rows.length === 4 && rows.every(row => row.textContent.includes('untrusted'))
  })
  await capture('heldout')
  await page.getByRole('tab', { name: 'Versions', exact: true }).click()
  await page.getByRole('tabpanel', { name: 'Versions' }).locator('table').waitFor()
  await capture('versions')
  await writeFile(path.join(output, 'provenance.json'), JSON.stringify({ server: 'Phoenix 20.8.0', origin: new URL(receipt.url).origin,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    tree: 'uncommitted artifact implementation; existing local Compose server', modelRound: false, receipt, frames }, null, 2) + '\n', { mode: 0o600 })
} finally { await browser.close() }
