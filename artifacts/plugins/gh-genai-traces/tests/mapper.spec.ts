import { describe, expect, it } from 'vitest'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { ContentPolicy } from '../src/content.ts'
import { TraceMapper } from '../src/mapper.ts'
import { replaySnapshot } from '../src/replay.ts'
import { createProvider, diagnostics, SourceIds } from '../src/transport.ts'
import { fixture } from './fixture.ts'

function pipeline() {
  const settings = resolveConfig({ content: 'rich-redacted' })
  const stats = diagnostics()
  const ids = new SourceIds()
  const exporter = new InMemorySpanExporter()
  const provider = createProvider(settings, stats, ids, exporter)
  const mapper = new TraceMapper(provider.getTracer('test'), ids, settings, new ContentPolicy(settings, {}), stats, 'replay')
  return { settings, stats, exporter, provider, mapper }
}

describe('canonical replay', () => {
  it('exports a tool trajectory with sibling model/tool spans and request-time context', async () => {
    const p = pipeline()
    try {
      const source = fixture()
      const before = JSON.stringify(source)
      await replaySnapshot(source, p.mapper, p.settings, () => p.provider.forceFlush())
      const spans = p.exporter.getFinishedSpans()
      const models = spans.filter(span => span.attributes['gen_ai.operation.name'] === 'chat')
      const tool = spans.find(span => span.attributes['gen_ai.operation.name'] === 'execute_tool')!
      expect(models).toHaveLength(2)
      expect(tool.parentSpanContext?.spanId).toBe(models[0]?.parentSpanContext?.spanId)
      expect(models[0]?.attributes['gen_ai.usage.input_tokens']).toBe(12)
      expect(models[1]?.attributes['gen_ai.usage.input_tokens']).toBe(22)
      expect(JSON.parse(String(models[0]?.attributes['gen_ai.tool.definitions']))[0].name).toBe('read')
      expect(String(models[0]?.attributes['gen_ai.input.messages'])).not.toContain('The value is 42')
      expect(String(models[1]?.attributes['gen_ai.input.messages'])).toContain('42')
      expect(models[0]?.attributes).not.toHaveProperty('gen_ai.response.time_to_first_chunk')
      expect(p.stats.spansDropped + p.stats.spansFailed + p.stats.captureErrors).toBe(0)
      expect(JSON.stringify(source)).toBe(before)
    } finally { p.mapper.shutdown(); await p.provider.shutdown() }
  })
  it('repeated replay produces stable identities', async () => {
    const source = fixture('stable')
    const collect = async () => {
      const p = pipeline()
      try {
        await replaySnapshot(source, p.mapper, p.settings, () => p.provider.forceFlush())
        return p.exporter.getFinishedSpans().map(span => [span.attributes['gh.source.id'], span.spanContext().traceId, span.spanContext().spanId])
      } finally { p.mapper.shutdown(); await p.provider.shutdown() }
    }
    expect(await collect()).toEqual(await collect())
  })
  it('excludes inherited spans and usage from the child', async () => {
    const p = pipeline()
    try {
      const source = fixture()
      const child = { ...source, session: { ...source.session, id: SessionId('child'), parentSession: source.session.id, isSeeded: true }, inheritedEventCount: SessionLogOffset(source.events.length) }
      await replaySnapshot(child, p.mapper, p.settings, () => p.provider.forceFlush())
      expect(p.exporter.getFinishedSpans()).toHaveLength(0)
    } finally { p.mapper.shutdown(); await p.provider.shutdown() }
  })
  it('marks unfinished turns incomplete instead of successful', async () => {
    const p = pipeline()
    try {
      const source = fixture()
      for (const event of source.events.slice(0, 3)) p.mapper.event(source.session, 0, event)
      p.mapper.disposeSession(String(source.session.id), 2000)
      await p.provider.forceFlush()
      const root = p.exporter.getFinishedSpans().find(span => span.attributes['gen_ai.operation.name'] === 'invoke_agent')!
      expect(root.attributes).toMatchObject({ 'gh.turn.outcome': 'incomplete', 'gh.capture.incomplete': true })
    } finally { p.mapper.shutdown(); await p.provider.shutdown() }
  })
})


it('correlates eight simultaneous workflow children through recorded child identities', async () => {
  const p = pipeline()
  try {
    const parent = fixture('parent')
    const session = Session.create(parent.session.id, parent.events, parent.session)
    session.append('turn/start', { turn: 2 })
    session.append('step/start', { turn: 2, step: 1 })
    const runId = 'workflow-fixture' as import('@deepseek-ai/dsh-tool-workflow/types').ToolWorkflowRunStartData['runId']
    session.append('tool-workflow/run-start', { runId, name: 'eight children' })
    const children = Array.from({ length: 8 }, (_, index) => fixture(`child-${index}`))
    for (const [index, child] of children.entries()) session.append('tool-workflow/agent-start', { runId, seq: index, label: `child ${index}`, childId: child.session.id })
    for (const event of session.snapshotEvents()) p.mapper.event(session.header, 0, event)
    for (let index = 0; index < children[0]!.events.length; index++) {
      for (const child of children) p.mapper.event({ ...child.session, parentSession: parent.session.id }, 0, child.events[index]!)
    }
    p.mapper.disposeSession('parent', Date.now())
    await p.provider.forceFlush()
    const spans = p.exporter.getFinishedSpans()
    const workflow = spans.find(span => span.attributes['gh.workflow.run_id'] === runId)!
    const childRoots = spans.filter(span => span.name === 'invoke_agent dsh' && String(span.attributes['gen_ai.conversation.id']).startsWith('child-'))
    expect(childRoots).toHaveLength(8)
    expect(new Set(childRoots.map(span => span.spanContext().traceId)).size).toBe(8)
    expect(childRoots.every(span => span.links.some(link => link.context.spanId === workflow.spanContext().spanId))).toBe(true)
    expect(p.stats.captureErrors + p.stats.spansDropped).toBe(0)
  } finally { p.mapper.shutdown(); await p.provider.shutdown() }
})

it('separates concurrent calls, retry attempts, and auxiliary purposes', async () => {
  const p = pipeline()
  try {
    for (const id of ['a', 'b']) {
      const source = fixture(id)
      for (const event of source.events.slice(0, 3)) p.mapper.event(source.session, 0, event)
    }
    const request = (id: string) => ({ provider: 'fixture', model: 'fixture', messages: [], sessionId: SessionId(id) })
    p.mapper.startCall('a1', request('a'), 1100)
    p.mapper.startCall('b1', request('b'), 1101)
    p.mapper.endCall('a1', { ended: 1110, blocks: [], finish: 'error', truncated: false })
    p.mapper.startCall('title', { ...request('a'), purpose: 'session-title' }, 1111)
    p.mapper.startCall('a2', request('a'), 1112)
    for (const id of ['b1', 'a2', 'title']) p.mapper.endCall(id, { ended: 1150, blocks: [], finish: 'stop', truncated: false })
    p.mapper.shutdown()
    await p.provider.forceFlush()
    const models = p.exporter.getFinishedSpans().filter(span => span.attributes['gen_ai.operation.name'] === 'chat')
    expect(models).toHaveLength(4)
    const retry = models.find(span => span.attributes['gen_ai.conversation.id'] === 'a' && span.attributes['gh.call.attempt'] === 2)!
    expect(retry.attributes['gh.call.purpose']).toBe('conversation')
    const title = models.find(span => span.attributes['gh.call.purpose'] === 'session-title')!
    expect(title.parentSpanContext?.spanId).not.toBe(retry.parentSpanContext?.spanId)
    expect(new Set(models.filter(span => span.attributes['gen_ai.conversation.id'] === 'a').map(span => span.spanContext().spanId)).size).toBe(3)
  } finally { p.mapper.shutdown(); await p.provider.shutdown() }
})

it('replays the recorded headless session through current upstream validation', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = JSON.parse(await readFile(new URL('./fixtures/recorded-session.json', import.meta.url), 'utf8')) as import('@deepseek-ai/dsh-session-query').SessionLogSnapshot
  Session.create(source.session.id, source.events, source.session, source.inheritedEventCount)
  const p = pipeline()
  try {
    await replaySnapshot(source, p.mapper, p.settings, () => p.provider.forceFlush())
    const spans = p.exporter.getFinishedSpans()
    expect(spans.filter(span => span.attributes['gen_ai.operation.name'] === 'chat')).toHaveLength(2)
    expect(spans.filter(span => span.attributes['gen_ai.operation.name'] === 'execute_tool')).toHaveLength(1)
    expect(p.stats.spansFailed + p.stats.spansDropped + p.stats.captureErrors).toBe(0)
  } finally { p.mapper.shutdown(); await p.provider.shutdown() }
})
