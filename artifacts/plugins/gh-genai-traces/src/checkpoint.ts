/** Private atomic processing checkpoints; Phoenix remains the dataset owner. */
import { mkdir, readFile, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { digest } from './curation.ts'

/** Persist one complete JSON checkpoint without exposing a partial replacement.
 * @param file - caller-owned checkpoint path.
 * @param value - serializable stage result or rejection.
 * @returns after the file is synced and atomically replaced.
 */
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await atomicText(file, JSON.stringify(value) + '\n')
}

/** Replace a complete private text artifact atomically.
 * @param file - caller-owned output path.
 * @param content - complete serialized file, including final newline.
 * @returns after file synchronization and replacement.
 */
export async function atomicText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

/** A source/task condition that cannot change without invalidating the checkpoint identity. */
export class DeterministicRejection extends Error {}

interface Checkpoint<T> { key: string; result?: T; rejection?: string; retryable?: boolean }

/** Reuse only a checkpoint for the exact source, task, grader, and configuration.
 * @param file - private result path.
 * @param identity - all inputs affecting this stage.
 * @param work - independently repeatable work.
 * @returns prior or newly persisted result; failures are durable rejection records.
 */
export async function checkpoint<T>(file: string, identity: unknown, work: () => Promise<T>): Promise<Checkpoint<T>> {
  const key = digest(identity)
  let existing: string | undefined
  try { existing = await readFile(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (existing) {
    const prior = JSON.parse(existing) as Checkpoint<T>
    if (prior.key === key && (Object.hasOwn(prior, 'result') || prior.retryable === false)) return prior
  }
  let record: Checkpoint<T>
  try { record = { key, result: await work() } } catch (error) { record = { key, rejection: String(error), retryable: !(error instanceof DeterministicRejection) } }
  await atomicJson(file, record)
  return record
}
