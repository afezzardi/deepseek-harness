/** Isolated fixture reset and independent filesystem reward observations. */
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { digest } from './curation.ts'

const filesSchema = z.record(z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/), z.string())
const bytesHash = (value: string) => createHash('sha256').update(value).digest('hex')
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
      if (!(await lstat(file)).isFile() || bytesHash(await readFile(file, 'utf8')) !== expectedHash) inputsUnchanged = false
    } catch { inputsUnchanged = false }
  }
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
  return { inputsUnchanged, outputExists, outputSyntax, outputSemantics, reward: Number(inputsUnchanged && outputSemantics) }
}
