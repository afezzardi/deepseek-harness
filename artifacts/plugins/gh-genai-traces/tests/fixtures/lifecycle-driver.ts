/** Built lifecycle driver over the shipped profile, with a keyless provider. */
import { readdir, writeFile } from 'node:fs/promises'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { readArtifactSnapshot } from '../../src/snapshot.ts'

await writeFile('lifecycle-task.json', JSON.stringify({ prompt: 'Read the fixture using the shell.', continuation: 'Read it again.' }))
process.env.GH_LIFECYCLE_TASK = `${process.cwd()}/lifecycle-task.json`
const completed = Promise.withResolvers<number>()
const ctx = await bootProductionProfile({ binName: 'gh-lifecycle-test', profile: 'headless', overlayPaths: [process.argv[2]!],
  prepare: ctx => { ctx.provide('appExit', completed.resolve) } })
try {
  const code = await completed.promise
  if (code !== 0) throw Error(`Lifecycle driver exited ${code}`)
  const buckets = await readdir('.sessions', { withFileTypes: true })
  const ids = (await Promise.all(buckets.filter(b => b.isDirectory()).map(async b => readdir(`.sessions/${b.name}`, { withFileTypes: true })))).flat().filter(e => e.isDirectory()).map(e => e.name)
  if (ids.length !== 1) throw Error('Expected one persisted resumed session')
  const snapshot = await readArtifactSnapshot(ctx, SessionId(ids[0]!))
  await writeFile('lifecycle-result.json', JSON.stringify(snapshot))
} finally { await ctx.fiber.dispose() }
