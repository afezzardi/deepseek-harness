/** Optional keyless integration against the pinned local Phoenix server. */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { createProvider, diagnostics, SourceIds } from '../src/transport.ts'
import { resolveConfig } from '../src/config.ts'
import { ContentPolicy } from '../src/content.ts'
import { TraceMapper } from '../src/mapper.ts'
import { replaySnapshot } from '../src/replay.ts'
import { evaluateReadFixture } from '../examples/evaluation.ts'
import { fixture } from './fixture.ts'

interface PhoenixSpan {
  id: string
  name: string
  context: { trace_id: string; span_id: string }
  span_kind: string
  parent_id: string | null
  attributes: Record<string, unknown>
}
const endpoint = process.env.GH_PHOENIX_URL
it.skipIf(!endpoint)('ingests native GenAI spans, deduplicates replay, and links an evaluated dataset example', async () => {
  const project = `gh-validation-${randomUUID()}`
  const base = endpoint!
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
    return response.json()
  }
  const source = fixture(project)
  const settings = resolveConfig({ endpoint: process.env.GH_GENAI_OTLP_ENDPOINT ?? `${base}/v1/traces`, project, content: 'rich-redacted' })
  const exportOnce = async (barrier = false) => {
    const ids = new SourceIds()
    const stats = diagnostics()
    const provider = createProvider(settings, stats, ids)
    const mapper = new TraceMapper(provider.getTracer('gh-validation'), ids, settings, new ContentPolicy(settings, {}), stats, 'replay')
    try {
      await replaySnapshot(source, mapper, settings, () => provider.forceFlush())
      if (barrier) { ids.key = `${project}/barrier`; provider.getTracer('gh-validation').startSpan('replay-barrier').end(); await provider.forceFlush() }
    }
    finally { mapper.shutdown(); await provider.shutdown() }
    expect(stats.spansFailed + stats.spansDropped).toBe(0)
    return stats.spansExported
  }
  const exported = await exportOnce()
  let spans: PhoenixSpan[] = []
  const until = Date.now() + 15_000
  while (Date.now() < until) {
    const response = await fetch(`${base}/v1/projects/${project}/spans?limit=100`)
    if (response.ok) spans = ((await response.json()) as { data: PhoenixSpan[] }).data
    if (spans.length === exported) break
    await delay(50)
  }
  expect(spans).toHaveLength(exported)
  const models = spans.filter(span => span.span_kind === 'LLM')
  expect(models).toHaveLength(2)
  const tool = spans.find(span => span.span_kind === 'TOOL')!
  expect(tool).toBeDefined()
  const first = models.find(span => String(span.attributes['gen_ai.input.messages']).includes('Read fixture.txt'))!
  expect(first).toBeDefined()
  // Phoenix's ingestion conversion must materialize tool schemas and prompt
  // counts, not merely retain our unrecognized native attributes.
  expect(models.map(span => span.attributes['llm.token_count.prompt']).sort()).toEqual([12, 22])
  expect(models.every(span => span.attributes['llm.input_messages.0.message.role'] === 'system')).toBe(true)
  expect(models.every(span => String(span.attributes['llm.tools.0.tool.json_schema']).includes('Read one file'))).toBe(true)
  await exportOnce(true)
  let repeated: PhoenixSpan[] = []
  const barrierUntil = Date.now() + 15_000
  while (Date.now() < barrierUntil) {
    repeated = (await request(`/v1/projects/${project}/spans?limit=100`) as { data: PhoenixSpan[] }).data
    if (repeated.some(span => span.name === 'replay-barrier')) break
    await delay(50)
  }
  expect(repeated.some(span => span.name === 'replay-barrier')).toBe(true)
  expect(repeated).toHaveLength(exported + 1)
  const evaluated = await evaluateReadFixture(base, project, '42')
  expect(evaluated.dataset.num_created_examples).toBe(1)
  expect(evaluated.result.score).toBe(1)
  if (process.env.GH_GENAI_EVIDENCE) await writeFile(process.env.GH_GENAI_EVIDENCE, JSON.stringify({ project, exported, stored: spans.length, models: models.length, tools: spans.filter(span => span.span_kind === 'TOOL').length, spans, evaluated }, null, 2) + '\n')
}, 30_000)

it.skipIf(!endpoint)('stores independent native sessions for the same canonical sources in live and replay projects', async () => {
  const projects = [`gh-v3-live-${randomUUID()}`, `gh-v3-replay-${randomUUID()}`]
  const evidence = []
  for (const [index, project] of projects.entries()) {
    const settings = resolveConfig({ endpoint: process.env.GH_GENAI_OTLP_ENDPOINT ?? `${endpoint}/v1/traces`, project, content: 'rich-redacted' })
    const stats = diagnostics(), ids = new SourceIds(), provider = createProvider(settings, stats, ids)
    const mapper = new TraceMapper(provider.getTracer('gh-v3-sessions'), ids, settings, new ContentPolicy(settings, {}), stats, index ? 'replay' : 'live')
    try {
      for (const id of ['canonical-a', 'canonical-b']) await replaySnapshot(fixture(id), mapper, settings, () => provider.forceFlush())
    } finally { mapper.shutdown(); await provider.shutdown() }
    let sessions: { session_id: string; traces: { trace_id: string }[] }[] = []
    const until = Date.now() + 15_000
    while (Date.now() < until) {
      const response = await fetch(`${endpoint}/v1/projects/${project}/sessions`)
      if (response.ok) sessions = ((await response.json()) as { data: typeof sessions }).data
      if (sessions.length === 2) break
      await delay(50)
    }
    expect(sessions).toHaveLength(2)
    evidence.push({ project, sessions })
  }
  expect(new Set(evidence.flatMap(e => e.sessions.map(s => s.session_id))).size).toBe(4)
  expect(new Set(evidence.flatMap(e => e.sessions.flatMap(s => s.traces.map(t => t.trace_id)))).size).toBe(4)
  if (process.env.GH_GENAI_EVIDENCE) await writeFile(`${process.env.GH_GENAI_EVIDENCE}.sessions.json`, JSON.stringify(evidence, null, 2) + '\n')
}, 40_000)

it.skipIf(!endpoint)('reconciles native HUMAN ratings, edits, and deletion against canonical model spans', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { FeedbackPublisher } = await import('../src/feedback.ts')
  const stateDirectory = await mkdtemp(`${tmpdir()}/gh-native-feedback-`)
  const project = `gh-feedback-v4-${randomUUID()}`, source = fixture(project)
  const settings = resolveConfig({ endpoint: `${endpoint}/v1/traces`, project, content: 'rich-redacted', feedback: { enabled: true, endpoint: endpoint!, stateDirectory } })
  const stats = diagnostics(), ids = new SourceIds(), provider = createProvider(settings, stats, ids)
  const policy = new ContentPolicy(settings, {}), mapper = new TraceMapper(provider.getTracer('native-feedback'), ids, settings, policy, stats, 'live')
  const publisher = new FeedbackPublisher(settings, policy, stats, { list: async () => [project], revision: async () => undefined, read: async () => source, flush: () => provider.forceFlush(),
    redact: (_source, event) => event, replay: async () => { throw Error('Live canonical span must be available') } })
  try {
    await replaySnapshot(source, mapper, settings, () => provider.forceFlush())
    const target = source.events.findLast(event => event.type === 'assistant/message')!
    if (target.type !== 'assistant/message') throw Error('Missing message')
    const messageId = target.data.message.id
    const { messageSpanId } = await import('../src/feedback.ts')
    const spanId = messageSpanId(project, 'live', project, messageId)
    await expect.poll(async () => {
      const response = await fetch(`${endpoint}/v1/projects/${project}/spans?span_id=${spanId}`)
      return response.ok ? ((await response.json()) as { data: unknown[] }).data.length : 0
    }, { timeout: 15000 }).toBe(1)
    const add = (rating: 'positive' | 'negative', version: string) => source.events.push({ type: 'feedback/message-put', seq: source.events.length as import('@deepseek-ai/dsh-session').SessionSeq, time: 4000,
      data: { sessionId: source.session.id, item: { messageId, rating, note: 'Native acceptance fixture', createdAt: 4000, updatedAt: 4000, version: version as import('@deepseek-ai/dsh-message-feedback').MessageFeedbackVersion } } })
    const read = async () => {
      const response = await fetch(`${endpoint}/v1/projects/${project}/span_annotations?span_ids=${spanId}`)
      if (!response.ok) throw Error(`Annotation read ${response.status}`)
      return ((await response.json()) as { data: Array<{ annotator_kind: string; result: { score: number }; metadata: { feedbackVersion: string } }> }).data
    }
    add('positive', '00000000-0000-4000-8000-000000000001'); await publisher.reconcile()
    expect(await read()).toMatchObject([{ annotator_kind: 'HUMAN', result: { score: 1 } }])
    add('negative', '00000000-0000-4000-8000-000000000002'); await publisher.reconcile(); await publisher.reconcile()
    expect(await read()).toMatchObject([{ annotator_kind: 'HUMAN', result: { score: 0 }, metadata: { feedbackVersion: '00000000-0000-4000-8000-000000000002' } }])
    expect(await read()).toHaveLength(1)
    const fork = structuredClone(source)
    fork.session = { ...fork.session, id: `${project}-fork` as typeof fork.session.id, parentSession: source.session.id }
    fork.inheritedEventCount = fork.events.length as typeof fork.inheritedEventCount
    fork.events.push({ type: 'feedback/message-put', seq: fork.events.length as import('@deepseek-ai/dsh-session').SessionSeq, time: 4001,
      data: { sessionId: fork.session.id, item: { messageId, rating: 'positive', createdAt: 4001, updatedAt: 4001, version: '00000000-0000-4000-8000-000000000003' as import('@deepseek-ai/dsh-message-feedback').MessageFeedbackVersion } } })
    const forkPublisher = new FeedbackPublisher(settings, policy, stats, { list: async () => [String(fork.session.id)], revision: async () => undefined,
      read: async id => id === fork.session.id ? fork : source, flush: () => provider.forceFlush(), redact: (_source, event) => event,
      replay: async () => { throw Error('Original live span must exist') } })
    try {
      await forkPublisher.reconcile()
      expect(await read()).toHaveLength(2)
      fork.events.push({ type: 'feedback/message-delete', seq: fork.events.length as import('@deepseek-ai/dsh-session').SessionSeq, time: 4002, data: { sessionId: fork.session.id, messageId } })
      await forkPublisher.reconcile()
      expect(await read()).toMatchObject([{ result: { score: 0 } }])
      expect(await read()).toHaveLength(1)
    } finally { await forkPublisher.shutdown() }
    source.events.push({ type: 'feedback/message-delete', seq: source.events.length as import('@deepseek-ai/dsh-session').SessionSeq, time: 4001, data: { sessionId: source.session.id, messageId } })
    await publisher.reconcile(); expect(await read()).toEqual([])
    expect(stats.feedbackFailures).toBe(0)
  } finally { await publisher.shutdown(); mapper.shutdown(); await provider.shutdown(); await rm(stateDirectory, { recursive: true, force: true }) }
}, 30000)
