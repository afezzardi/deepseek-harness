/** Offline v2 regression: known timing values, product projection parity, and refusals. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { sessionStatsProjectionDefinition as projection } from '../../packages/session/session-stats/src/projection.ts'
import type { SessionEvent } from '../../packages/core/session/src/index.ts'
import { foldSession } from './metrics.mts'
import { parseV2Log } from './v2-log.mts'

const header = { type: 'session', version: 2, id: 'v2-regression', createdAt: 0, isSeeded: false, delegationDepth: 0 }
const packed = { type: 'text-chunks', index: 0, time0: 120, dt: [30], texts: ['', 'hello'] }
const events = [
  { type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
  { type: 'assistant/attempt', time: 160, data: { turn: 1, step: 1, stream: [packed] } },
  { type: 'assistant/message', time: 300, surfaceOp: 'append', data: {
    turn: 1, step: 1, stream: [{ type: 'chunk', time: 220, chunk: { type: 'text-delta', index: 0, text: 'answer' } }],
    usage: { inputTokens: 12, outputTokens: 7 },
  } },
  { type: 'tool/call', time: 310, data: { callId: 'call-1', name: 'read' } },
  { type: 'tool/result', time: 340, surfaceOp: 'append', data: { message: { source: { callId: 'call-1' } } } },
  { type: 'step/end', time: 350, data: { turn: 1, step: 1 } },
  { type: 'turn/end', time: 360, data: { reason: { kind: 'completed' } } },
].map((event, seq) => ({ ...event, seq }))
const text = [header, ...events].map(row => JSON.stringify(row)).join('\n') + '\n'
const root = mkdtempSync(join(tmpdir(), 'dsh-v2-regression-'))
try {
  const file = join(root, 'session.v2.jsonl')
  writeFileSync(file, text)
  const metrics = foldSession(file)!
  const compressed = join(root, 'session.v2.jsonl.zstd')
  writeFileSync(compressed, Buffer.concat([
    zstdCompressSync(JSON.stringify(header) + '\n'),
    zstdCompressSync(events.map(row => JSON.stringify(row)).join('\n') + '\n'),
  ]))
  assert.deepEqual({ ...foldSession(compressed), file }, metrics)
  const broken = join(root, 'torn.jsonl.zstd')
  writeFileSync(broken, zstdCompressSync(text).subarray(0, 12))
  assert.throws(() => foldSession(broken), /torn/i)
  assert.equal(metrics.ttftMs, 50)
  assert.equal(metrics.llmMs, 200)
  assert.equal(metrics.decodeMs, 150)
  assert.equal(metrics.decodeTokens, 7)
  assert.equal(metrics.toolMs, 30)
  assert.deepEqual(metrics.promptTokens, [12])
  // Envelopes are validated by the physical codec; this fixture supplies only
  // payload fields read by these two folds, not complete model messages.
  let state = projection.init()
  for (const event of events) state = projection.apply(state, event as unknown as SessionEvent)
  for (const key of ['turns', 'steps', 'llmMs', 'ttftMs', 'ttftSteps', 'decodeMs', 'decodeTokens', 'toolMs'] as const) {
    assert.equal(metrics[key], state[key], key)
  }
  const direct = events.filter(e => e.type !== 'assistant/attempt').map((e, seq) => ({ ...e, seq }))
  writeFileSync(file, [header, ...direct].map(row => JSON.stringify(row)).join('\n'))
  assert.equal(foldSession(file)!.ttftMs, 120)
  assert.equal(foldSession(file)!.decodeMs, 80)
  assert.throws(() => parseV2Log(text.replace('"version":2', '"version":0')), /format v2/)
  assert.throws(() => parseV2Log(''), /format v2/)
  assert.throws(() => parseV2Log(text + '{broken'), /invalid JSON/)
  assert.throws(() => parseV2Log(text.replace('"seq":1', '"seq":99')), /seq|sequence/i)
  writeFileSync(file, 'compressed input is not JSONL')
  assert.throws(() => foldSession(file), /invalid JSON/)
  process.stdout.write('PASS v2 timing, projection parity, direct stream, old format, empty/corrupt input, and sequence validation\n')
} finally {
  rmSync(root, { recursive: true })
}
