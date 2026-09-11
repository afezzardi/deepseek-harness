/** Reusable grades depend on explicit grader and complete parent/child source identity. */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { gradingIdentity, GRADER_VERSION } from '../src/grading.ts'
import { checkpoint } from '../src/checkpoint.ts'
import { fixture } from './fixture.ts'

it('invalidates a cached grade when its child, implementation or explicit version changes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gh-audit-identity-'))
  try {
    const file = path.join(directory, 'checkpoint.json'), parent = fixture('parent'), child = fixture('child')
    let evaluations = 0
    const work = async () => ({ evaluation: ++evaluations })
    const original = gradingIdentity(parent, [child], 'implementation-a')
    expect(original.version).toBe(GRADER_VERSION)
    await checkpoint(file, original, work)
    await checkpoint(file, gradingIdentity(parent, [child], 'implementation-a'), work)
    expect(evaluations).toBe(1)
    const changed = structuredClone(child)
    changed.events.find(e => e.type === 'tool/call')!.data.arguments = '{"file_path":"changed.json"}'
    await checkpoint(file, gradingIdentity(parent, [changed], 'implementation-a'), work)
    expect(evaluations).toBe(2)
    await checkpoint(file, gradingIdentity(parent, [changed], 'implementation-b'), work)
    expect(evaluations).toBe(3)
    await checkpoint(file, { ...gradingIdentity(parent, [changed], 'implementation-b'), version: 'future-grader' }, work)
    expect(evaluations).toBe(4)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it.skipIf(!existsSync(new URL('../lib/audit-code-identity.json', import.meta.url)))('records the environment grader explicitly in the built audit source inventory', async () => {
  // Like the built-profile smoke, this assertion consumes the plugin build output.
  const inventory = JSON.parse(await readFile(new URL('../lib/audit-code-identity.json', import.meta.url), 'utf8')) as { files: Record<string, string> }
  for (const name of ['src/reward.ts', 'src/grading.ts', 'src/agent-grading.ts', 'src/curation.ts', 'src/snapshot.ts', 'experiments/audit-profile.ts']) {
    expect(inventory.files[name]).toBe(createHash('sha256').update(await readFile(new URL('../' + name, import.meta.url))).digest('hex'))
  }
})
