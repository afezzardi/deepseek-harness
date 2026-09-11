/** Coordinator adoption uses current-format observations when no live envelope was captured. */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionTelemetryCoordinator } from '@deepseek-ai/dsh-session-telemetry'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionObservationReader } from '@deepseek-ai/dsh-session-query/src/observation.ts'
import { GenAITraces } from '../src/index.ts'
import { CaptureWorkQueue, diagnostics } from '../src/transport.ts'
import { resolveConfig } from '../src/config.ts'

it('recovers adopted history through the actual observation reader without bypassing redaction', async () => {
  const session = Session.create(SessionId('late-attach'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'private-source' }] }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const stats = diagnostics(), queue = new CaptureWorkQueue(20, stats)
  const mapper = { event: vi.fn(), disposeSession: vi.fn() }, correlation = { event: vi.fn(), flush: vi.fn() }
  const ctx = { sessions: { list: () => [session], get: () => session }, get: () => undefined,
    on: () => () => {}, effect: () => () => {},
    waterfall: (_name: string, record: { body: unknown }) => ({ ...record, body: JSON.parse(JSON.stringify(record.body).replaceAll('private-source', '[REDACTED]')) }) } as unknown as Context
  const reader = new SessionObservationReader(ctx)
  Object.assign(ctx, { sessionQuery: { observeSession: reader.read.bind(reader) } })
  const backend: GenAITraces = Object.assign(Object.create(GenAITraces.prototype) as GenAITraces, { ctx, settings: resolveConfig({}), diagnostics: stats,
    queue, mapper, correlation, envelopes: new Map(), recovered: new Map() })
  new SessionTelemetryCoordinator(ctx, backend, { capture: 'live', includeHistory: false })
  await queue.close()
  expect(mapper.event).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(mapper.event.mock.calls)).toContain('[REDACTED]')
  expect(JSON.stringify(mapper.event.mock.calls)).not.toContain('private-source')
  expect(stats.captureErrors).toBe(0)
  expect(session.snapshotEvents()[1]).toMatchObject({ data: { content: [{ text: 'private-source' }] } })
})

it('maps child events when parent persistence is unavailable and retries only at a new turn', async () => {
  const session = Session.create(SessionId('child-recovery'))
  const stats = diagnostics(), queue = new CaptureWorkQueue(20, stats)
  const mapper = { event: vi.fn(), hasOwnership: () => false }, correlation = { event: vi.fn(), flush: vi.fn() }
  const open = vi.fn(async () => { throw Error('SessionPersistenceNotFoundError') })
  const ctx = { sessions: { get: () => undefined }, sessionPersistence: { open } } as unknown as Context
  const envelopes = new Map()
  const backend: GenAITraces = Object.assign(Object.create(GenAITraces.prototype) as GenAITraces, { ctx, settings: resolveConfig({}), diagnostics: stats,
    queue, mapper, correlation, envelopes, recovered: new Map(), ownershipAttempts: new Map() })
  for (let seq = 0; seq < 4; seq++) {
    const type = seq === 0 || seq === 3 ? 'turn/start' : 'turn/end'
    envelopes.set(`${session.id}:${seq}`, { header: { ...session.header, parentSession: SessionId('missing-parent') }, inherited: 0, event: { seq, type, time: seq } })
    backend.emit({ channel: 'ledger', time: seq, severity: 'info', attributes: { 'session.id': session.id, 'event.seq': seq, 'event.type': type }, body: { turn: seq + 1 } })
  }
  await queue.close()
  expect(mapper.event).toHaveBeenCalledTimes(4)
  expect(open).toHaveBeenCalledTimes(2)
  expect(stats.ownershipRecoveryFailures).toBe(2)
  expect(stats.captureErrors).toBe(0)
})

it('bounds shutdown while a capture read is pending and suppresses queued work after abandonment', async () => {
  const stats = diagnostics(), queue = new CaptureWorkQueue(20, stats)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), mapped = vi.fn()
  queue.push(async () => { entered.resolve(); await release.promise; if (!queue.abandoned) mapped() })
  queue.push(mapped)
  await entered.promise
  const backend: GenAITraces = Object.assign(Object.create(GenAITraces.prototype) as GenAITraces, { settings: resolveConfig({ shutdownTimeoutMillis: 10 }), diagnostics: stats,
    queue, correlation: { flush: vi.fn() }, mapper: { shutdown: vi.fn() }, provider: { shutdown: async () => {} },
    ctx: { logger: { info: vi.fn() } }, envelopes: new Map(), recovered: new Map(), ownershipAttempts: new Map(), replayWork: Promise.resolve() })
  try {
    await expect(backend.shutdown()).rejects.toThrow('shutdown deadline exceeded')
    expect(stats.captureAbandoned).toBe(2)
  } finally { release.resolve(); await queue.close() }
  expect(mapped).not.toHaveBeenCalled()
})


it('rejects enabled feedback on Windows before mounting effects', () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  try {
    expect(() => resolveConfig({ feedback: { enabled: true } })).toThrow('POSIX flock')
    expect(resolveConfig({}).feedback.enabled).toBe(false)
  } finally { vi.unstubAllGlobals() }
})
