/** Create a private local database credential once, without printing it. */
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
try {
  await writeFile(new URL('./.env', import.meta.url), `PHOENIX_DB_PASSWORD=${randomBytes(24).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
  console.log('Created stack/.env (0600); existing stack credentials are never overwritten.')
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.log('stack/.env already exists.')
}
