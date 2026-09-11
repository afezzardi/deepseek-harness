/** Isolated fixture reset and independent filesystem reward observations. */
import { mkdir, mkdtemp, readFile, writeFile, lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { digest } from './curation.ts'

const filesSchema = z.record(z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/), z.string())
const bytesHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
/** Fresh directory and immutable expected input hashes for one rollout. */
export interface RewardEnvironment { directory: string; inputHashes: Record<string, string> }

/** Allocate a new environment without modifying any previous rollout.
 * @param root - caller-owned directory for experiment fixtures.
 * @param files - serialized flat fixture files; path traversal is rejected.
 * @returns private directory and pre-rollout fixture hashes.
 */
export async function resetRewardEnvironment(root: string, files: Record<string, string>): Promise<RewardEnvironment> {
  filesSchema.parse(files)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'rollout-'))
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content, { flag: 'wx', mode: 0o600 })
  return { directory, inputHashes: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, bytesHash(content)])) }
}

/** Grade final file state independently of the assistant's completion claim.
 * @param environment - reset result carrying pre-rollout input identities.
 * @param expected - expected JSON value for the fixed answer.json output.
 * @returns separate input-integrity and output-semantic observations.
 */
export async function gradeRewardEnvironment(environment: RewardEnvironment, expected: unknown) {
  let inputsUnchanged = true
  for (const [name, expectedHash] of Object.entries(environment.inputHashes)) {
    const file = path.join(environment.directory, name)
    try {
      if (!(await lstat(file)).isFile() || bytesHash(await readFile(file)) !== expectedHash) inputsUnchanged = false
    } catch { inputsUnchanged = false }
  }
  const unexpected = (await readdir(environment.directory)).filter(name => !Object.hasOwn(environment.inputHashes, name) && name !== 'answer.json')
  let outputExists = false
  let outputSyntax = false
  let outputSemantics = false
  const file = path.join(environment.directory, 'answer.json')
  try {
    outputExists = (await lstat(file)).isFile()
    if (outputExists) {
      const output: unknown = JSON.parse(await readFile(file, 'utf8'))
      outputSyntax = true
      outputSemantics = digest(output) === digest(expected)
    }
  } catch { /* Missing/unreadable files and invalid JSON cannot earn filesystem reward. */ }
  return { version: 2 as const, scope: environment.directory, inputsUnchanged, unexpected, outputExists, outputSyntax, outputSemantics, reward: Number(inputsUnchanged && !unexpected.length && outputSemantics) }
}

/** Observe every workspace entry without following symbolic links.
 * @param directory - isolated fixture directory, excluding session/home infrastructure.
 * @returns relative paths with exact byte hashes and entry types.
 */
export async function inventoryWorkspace(directory: string): Promise<Record<string, { kind: 'file' | 'directory' | 'symlink' | 'other'; hash: string | null }>> {
  const result: Record<string, { kind: 'file' | 'directory' | 'symlink' | 'other'; hash: string | null }> = {}
  const walk = async (relative: string): Promise<void> => {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const key = relative ? `${relative}/${name}` : name, file = path.join(directory, key), stat = await lstat(file)
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other'
      result[key] = { kind, hash: kind === 'file' ? bytesHash(await readFile(file)) : null }
      if (kind === 'directory') await walk(key)
    }
  }
  await walk(''); return result
}

/** Check allowed outputs, input integrity, deletions, unexpected entries, and symlinks.
 * This observation cannot establish writes outside the supplied directory.
 * @param directory - private fixture workspace.
 * @param before - inventory recorded before inference.
 * @param outputs - allowed relative output paths and exact JSON values.
 * @returns explicit failures and an independent environment observation.
 */
export async function gradeWorkspace(directory: string, before: Awaited<ReturnType<typeof inventoryWorkspace>>, outputs: Record<string, unknown>) {
  const after = await inventoryWorkspace(directory), failures: string[] = []
  for (const [name, entry] of Object.entries(before)) {
    if (!Object.hasOwn(outputs, name) && digest(after[name] ?? null) !== digest(entry)) failures.push(`input changed or deleted: ${name}`)
  }
  for (const [name, entry] of Object.entries(after)) {
    if (entry.kind === 'symlink' || entry.kind === 'other') failures.push(`unsupported entry: ${name}`)
    if (!Object.hasOwn(before, name) && !Object.hasOwn(outputs, name)) failures.push(`unexpected entry: ${name}`)
  }
  for (const [name, expected] of Object.entries(outputs)) {
    if (path.isAbsolute(name) || name.split('/').some(part => part === '..' || part === '')) throw Error('Invalid allowed output path')
    if (after[name]?.kind !== 'file') { failures.push(`missing regular output: ${name}`); continue }
    try { if (digest(JSON.parse(await readFile(path.join(directory, name), 'utf8'))) !== digest(expected)) failures.push(`incorrect output: ${name}`) }
    catch { failures.push(`unreadable JSON output: ${name}`) }
  }
  return { version: 2 as const, scope: directory, before, after, failures, status: failures.length ? 'fail' as const : 'pass' as const }
}
