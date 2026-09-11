import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { observeStream, type CallResult } from '../src/stream.ts'
import { resolveConfig } from '../src/config.ts'
const request: GenerateOptions = { provider: 'fixture', model: 'fixture', messages: [] }
const chunks: StreamChunk[] = [{ type: 'text-delta', index: 0, text: 'hello' }, { type: 'finish', reason: { kind: 'stop' } }]

describe('stream observation', () => {
  it('preserves object identities and calls downstream once', async () => {
    let nextCalls = 0
    const results: CallResult[] = []
    const out = []
    const stream = observeStream(request, () => { nextCalls++; return (async function* () { yield* chunks })() }, resolveConfig({}), () => {}, r => results.push(r), () => { throw Error('unexpected failure') })
    for await (const chunk of stream) out.push(chunk)
    expect(nextCalls).toBe(1)
    expect(out[0]).toBe(chunks[0])
    expect(out[1]).toBe(chunks[1])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ finish: 'stop', blocks: [{ type: 'text', text: 'hello' }] })
  })
  it('closes downstream on early return and marks the captured prefix incomplete', async () => {
    let closed = false
    const results: CallResult[] = []
    const stream = observeStream(request, () => (async function* () { try { yield* chunks } finally { closed = true } })(), resolveConfig({}), () => {}, r => results.push(r), () => {})
    for await (const _chunk of stream) break
    expect(closed).toBe(true)
    expect(results[0]?.finish).toBe('incomplete')
  })
  it('preserves downstream exception identity and contains observer errors', async () => {
    const error = new Error('provider failure')
    let defects = 0
    const stream = observeStream(request, () => (async function* () { yield chunks[0]!; throw error })(), resolveConfig({}), () => { throw Error('observer') }, () => { throw Error('observer') }, () => { defects++ })
    await expect((async () => { for await (const _chunk of stream) { /* consume the provider failure */ } })()).rejects.toBe(error)
    expect(defects).toBe(2)
  })
  it('keeps terminal usage even after the content buffer fills', async () => {
    const results: CallResult[] = []
    const stream = observeStream(request, () => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: 'x'.repeat(100) }
      yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), resolveConfig({ maxStreamBytes: 32 }), () => {}, r => results.push(r), () => {})
    for await (const _chunk of stream) { /* drain without changing provider values */ }
    expect(results[0]).toMatchObject({ truncated: true, usage: { inputTokens: 2, outputTokens: 4 }, finish: 'stop' })
  })
})
