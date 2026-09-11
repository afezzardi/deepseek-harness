/** HTTP and kernel-lock regressions for current durable human feedback. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { MessageFeedbackVersion } from '@deepseek-ai/dsh-message-feedback'
import { FeedbackPublisher, feedbackMutations, messageSpanId, type FeedbackSources } from '../src/feedback.ts'
import { resolveConfig } from '../src/config.ts'
import { ContentPolicy } from '../src/content.ts'
import { diagnostics } from '../src/transport.ts'
import { fixture } from './fixture.ts'

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'gh-feedback-'))
  const requests: { method: string; route: string; body: unknown }[] = []
  let live = true, replay = false, unavailable = false, replayCalls = 0
  const source = fixture()
  const target = source.events.findLast(e => e.type === 'assistant/message')!
  if (target.type !== 'assistant/message') throw Error('Missing fixture message')
  const messageId = target.data.message.id
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const text = Buffer.concat(parts).toString(), body = text ? JSON.parse(text) : undefined
    requests.push({ method: request.method!, route: request.url!, body })
    const span = body?.data?.[0]?.span_id
    response.statusCode = unavailable ? 503 : request.method === 'DELETE' ? 204
      : span === messageSpanId('feedback-test', 'live', 'fixture', messageId) ? live ? 200 : 404 : replay ? 200 : 404
    response.end()
  })
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }) }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error }
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Missing HTTP address')
  const settings = resolveConfig({ project: 'feedback-test', content: 'rich-redacted', secretEnv: ['TEST_SECRET'],
    feedback: { enabled: true, endpoint: `http://127.0.0.1:${address.port}`, stateDirectory: root } })
  const stats = diagnostics(), policy = new ContentPolicy(settings, { TEST_SECRET: 'sensitive-fixture-value' })
  const sources: FeedbackSources = { list: async () => ['fixture'], revision: async () => undefined, read: async () => source,
    replay: async () => { replay = true; replayCalls++ }, flush: async () => {}, redact: (_snapshot, event) => event }
  const publisher = new FeedbackPublisher(settings, policy, stats, sources)
  const put = (rating: 'positive' | 'negative', note?: string) => {
    source.events.push({ type: 'feedback/message-put', time: 3000, seq: source.events.length as SessionEvent['seq'], data: { sessionId: source.session.id,
      item: { messageId, rating, version: '00000000-0000-4000-8000-000000000001' as MessageFeedbackVersion, createdAt: 3000, updatedAt: 3000, ...note === undefined ? {} : { note } } } })
  }
  return { root, requests, source, messageId, publisher, settings, policy, stats, sources, put,
    setLive(value: boolean) { live = value }, setUnavailable(value: boolean) { unavailable = value }, replayCalls: () => replayCalls,
    close: async () => { await publisher.shutdown(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }) } }
}

it('upserts only current ratings with stable identifiers, redacts notes, and applies exact tombstones', async () => {
  const h = await harness()
  try {
    await h.publisher.reconcile(); expect(h.requests).toHaveLength(0)
    h.put('positive', 'sensitive-fixture-value'); await h.publisher.reconcile()
    const first = h.requests.find(r => r.method === 'POST')!.body as { data: Array<{ identifier: string; result: { score: number; explanation: string }; annotator_kind: string }> }
    expect(first.data[0]).toMatchObject({ annotator_kind: 'HUMAN', result: { score: 1, explanation: '[REDACTED]' } })
    h.put('negative'); await h.publisher.reconcile()
    const last = h.requests.filter(r => r.method === 'POST').at(-1)!.body as typeof first
    expect(last.data[0]?.identifier).toBe(first.data[0]?.identifier); expect(last.data[0]?.result.score).toBe(0)
    h.source.events.push({ type: 'feedback/message-delete', seq: h.source.events.length as SessionEvent['seq'], time: 3001, data: { sessionId: h.source.session.id, messageId: h.messageId } })
    h.requests.length = 0; await h.publisher.reconcile()
    expect(h.requests).toHaveLength(2)
    for (const request of h.requests) {
      expect(request.method).toBe('DELETE')
      const url = new URL(request.route, 'http://fixture')
      expect(url.searchParams.get('identifier')).toBe(first.data[0]?.identifier)
      expect(url.searchParams.get('name')).toBe('dsh.user_rating')
      expect(url.searchParams.get('delete_all')).toBe('true')
    }
  } finally { await h.close() }
})

it('recovers without receipts after an outage and replays absent live targets', async () => {
  const h = await harness()
  try {
    h.put('positive'); h.setUnavailable(true); await h.publisher.reconcile()
    expect(h.stats.feedbackPending).toBe(1); expect(h.stats.feedbackFailures).toBe(1)
    h.setUnavailable(false); h.setLive(false); await h.publisher.reconcile()
    expect(h.replayCalls()).toBe(1); expect(h.stats.feedbackPending).toBe(0)
    await h.publisher.reconcile(); expect(h.replayCalls()).toBe(1)
    h.setLive(true); h.put('negative'); await h.publisher.reconcile()
    expect(h.requests.at(-1)?.route).toContain('feedback-test-replay/span_annotations')
  } finally { await h.close() }
})

it('holds the kernel lock across asynchronous reads and permits recovery after release', async () => {
  const h = await harness(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const other = new FeedbackPublisher(h.settings, h.policy, diagnostics(), { ...h.sources, list: async () => { throw Error('Competing publisher entered') } })
  try {
    h.sources.list = async () => { entered.resolve(); await release.promise; return [] }
    const first = h.publisher.reconcile(); await entered.promise
    await expect(other.reconcile()).resolves.toBeUndefined()
    release.resolve(); await first
    await expect(other.reconcile()).rejects.toThrow('Competing publisher entered')
  } finally { release.resolve(); await other.shutdown(); await h.close() }
})

it('excludes feedback inherited from a different Session owner', () => {
  const source = fixture()
  source.events.push({ type: 'feedback/message-delete', time: 3000, seq: source.events.length as SessionEvent['seq'], data: { sessionId: 'different' as typeof source.session.id, messageId: 'message' as import('@deepseek-ai/dsh-llm').MessageId } })
  expect(feedbackMutations(source).size).toBe(0)
})

it('attaches a fork rating to the original message span without replacing the parent rating', async () => {
  const h = await harness()
  try {
    h.put('positive'); await h.publisher.reconcile()
    const parent = structuredClone(h.source)
    const original = h.requests.find(r => r.method === 'POST')!.body as { data: Array<{ identifier: string; span_id: string }> }
    h.source.session = { ...h.source.session, id: 'fork' as typeof h.source.session.id, parentSession: parent.session.id }
    h.source.inheritedEventCount = h.source.events.length as typeof h.source.inheritedEventCount
    h.sources.list = async () => ['fork']
    h.sources.read = async id => id === 'fork' ? h.source : parent
    h.put('negative'); h.requests.length = 0
    await h.publisher.reconcile()
    const fork = h.requests.find(r => r.method === 'POST')!.body as typeof original
    expect(fork.data[0]?.span_id).toBe(original.data[0]?.span_id)
    expect(fork.data[0]?.identifier).not.toBe(original.data[0]?.identifier)
    expect(fork.data[0]).toMatchObject({ metadata: { sessionId: 'fork', messageOwnerSessionId: 'fixture' }, result: { score: 0 } })
    expect(h.stats.feedbackPending).toBe(0)
    h.sources.read = async () => h.source
    h.put('positive')
    await h.publisher.reconcile()
    expect(h.stats.feedbackPending).toBe(1)
    expect(h.stats.feedbackFailures).toBe(1)
  } finally { await h.close() }
})

it('skips unchanged durable logs and acknowledged ratings while retrying failed revisions', async () => {
  const h = await harness()
  let revision = 0, reads = 0
  const read = h.sources.read
  h.sources.revision = async () => revision
  h.sources.read = async id => { reads++; return read(id) }
  try {
    h.put('positive'); await h.publisher.reconcile()
    const first = h.requests.find(r => r.method === 'POST')!.body
    expect(first).toMatchObject({ data: [{ metadata: { noteCapture: 'absent' } }] })
    h.requests.length = 0
    await h.publisher.reconcile()
    expect(reads).toBe(1); expect(h.requests).toHaveLength(0)
    revision++; await h.publisher.reconcile()
    expect(reads).toBe(2); expect(h.requests).toHaveLength(0)
    revision++; h.put('negative'); h.setUnavailable(true); await h.publisher.reconcile()
    expect(h.stats.feedbackPending).toBe(1)
    h.setUnavailable(false); await h.publisher.reconcile()
    expect(h.stats.feedbackPending).toBe(0)
    expect(reads).toBe(4)
  } finally { await h.close() }
})
