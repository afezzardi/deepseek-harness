import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

it('loads the built tracing backend in headless and replays without rewriting the session', async () => {
  const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
  await runLoaderSmoke({
    label: 'gh-genai-traces', tempDirPrefix: 'gh-genai-smoke-',
    binScript: driver, libBinScript: driver, mode: 'lib',
    configPath: fileURLToPath(new URL('./fixtures/headless.patch.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    inspect: async cwd => {
      const events = JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8')) as { before: SessionEvent[]; after: SessionEvent[]; header: import('@deepseek-ai/dsh-session').SessionHeader }
      const captures = JSON.parse(await readFile(join(cwd, 'captures.json'), 'utf8')) as string[]
      if (process.env.GH_GENAI_RECORDING) await writeFile(process.env.GH_GENAI_RECORDING, JSON.stringify({ session: events.header, inheritedEventCount: 0, events: events.before }, null, 2) + '\n')
      expect(events.before).toEqual(events.after)
      expect(events.before.some(event => event.type === 'tool/result')).toBe(true)
      expect(events.before.filter(event => event.type === 'assistant/message')).toHaveLength(2)
      expect(captures.length).toBeGreaterThanOrEqual(2)
      const wire = Buffer.concat(captures.map(value => Buffer.from(value, 'base64'))).toString()
      const stats = JSON.parse(await readFile(join(cwd, 'diagnostics.json'), 'utf8'))
      expect(stats.correlationFailures).toBe(0)
      expect(stats.captureErrors).toBe(0)
      expect(stats.recordsDropped).toBe(0)
      expect(wire).toContain('gh.message.id')
      for (const event of events.before) if (event.type === 'assistant/message') expect(wire).toContain(event.data.message.id)
      expect(wire).toContain('gen_ai.input.messages')
      expect(wire).toContain('execute_tool bash')
      expect(wire).toContain('gh-genai-traces-replay')
      expect(wire).not.toContain('fixture-secret-not-for-export')
    },
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

it('runs two turns with a real persistence flush, disposal and resume in the built profile', async () => {
  const driver = fileURLToPath(new URL('./fixtures/lifecycle-driver.ts', import.meta.url))
  await runLoaderSmoke({ label: 'gh-lifecycle', tempDirPrefix: 'gh-lifecycle-smoke-', binScript: driver, libBinScript: driver, mode: 'lib',
    configPath: fileURLToPath(new URL('./fixtures/lifecycle.patch.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    inspect: async cwd => {
      const snapshot = JSON.parse(await readFile(join(cwd, 'lifecycle-result.json'), 'utf8')) as { events: SessionEvent[] }
      expect(snapshot.events.filter(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')).toHaveLength(2)
      expect(snapshot.events.some(e => e.type === 'session/end-seed')).toBe(true)
      expect(snapshot.events.filter(e => e.type === 'user/message' && e.data.source.kind === 'user')).toHaveLength(2)
    },
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
