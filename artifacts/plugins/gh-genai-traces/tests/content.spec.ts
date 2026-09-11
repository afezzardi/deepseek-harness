import { describe, expect, it } from 'vitest'
import { ContentPolicy, usageAttributes } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'

describe('content and accounting', () => {
  it('redacts known secrets, credential fields, and embedded assignments without changing input', () => {
    const input = { password: 'p', content: 'my-private-key Bearer abc123 api_key=xyz', tools: [{ name: 'read' }] }
    const before = structuredClone(input)
    const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted', secretEnv: ['KEY'] }), { KEY: 'my-private-key' })
    const attrs = policy.attributes('payload', input)
    expect(attrs.payload).not.toMatch(/my-private-key|abc123|xyz|"p"/)
    expect(JSON.parse(String(attrs.payload)).tools).toEqual(input.tools)
    expect(input).toEqual(before)
  })
  it('withholds unserializable content and labels oversized JSON without emitting invalid JSON', () => {
    const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted', maxContentBytes: 8 }), {})
    expect(policy.attributes('payload', 'too long to fit')).toMatchObject({ 'gh.content.payload.status': 'truncated' })
    expect(policy.attributes('payload', 2n)).toEqual({ 'gh.content.payload.status': 'withheld' })
    expect(policy.attributes('payload', 'too long to fit')).not.toHaveProperty('payload')
  })
  it('defaults to metadata-only capture', () => {
    const policy = new ContentPolicy(resolveConfig({}), {})
    expect(policy.attributes('payload', 'secret')).toEqual({ 'gh.content.payload.status': 'omitted' })
  })
  it('adds disjoint input buckets and does not add reasoning twice', () => {
    expect(usageAttributes({ inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5, outputTokens: 8, reasoningTokens: 3 }))
      .toMatchObject({ 'gen_ai.usage.input_tokens': 35, 'gen_ai.usage.output_tokens': 8, 'gen_ai.usage.reasoning.output_tokens': 3 })
  })
  it('does not replace unknown cache buckets with zero', () => {
    expect(usageAttributes({ inputTokens: 10, outputTokens: 8 })).not.toHaveProperty('gen_ai.usage.input_tokens')
    expect(usageAttributes({ inputTokens: 10, outputTokens: 8, totalTokens: 43 })['gen_ai.usage.input_tokens']).toBe(35)
  })
  it('rejects contradictory aggregate counts', () => {
    expect(usageAttributes({ inputTokens: 10, outputTokens: 8, cacheReadTokens: 20, cacheWriteTokens: 5, totalTokens: 30 }))
      .not.toHaveProperty('gen_ai.usage.input_tokens')
  })
  it.each([{ maxQueueSize: 1, maxExportBatchSize: 2 }, { endpoint: 'file:///tmp/x' }, { endpoint: 'http://user:pass@localhost' }, { maxPendingRecords: 0 }])('rejects invalid configuration %j', input => {
    expect(() => resolveConfig(input)).toThrow()
  })
})
