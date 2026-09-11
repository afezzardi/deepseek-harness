/** Regression coverage for canonical identities, bounded loss, and reviewed prefixes. */
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { LlmAttemptId, createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionFormatEventCollector, type SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { sessionFormatV2ToV3, restoreReleasedV3Artifact } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { CallCorrelation } from '../src/correlation.ts'
import { CaptureWorkQueue, diagnostics } from '../src/transport.ts'
import { curateSession, curationSourceHash, selectToolDecisions, digest, TRANSFORMATION, type Grade } from '../src/curation.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { fixture } from './fixture.ts'

const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted' }), {})
const grade: Grade = { version: 'probe', required: ['tools'], execution: { exitCode: 0, timedOut: false },
  observations: { syntax: { status: 'pass', evidence: ['fixture'] }, semantics: { status: 'pass', evidence: ['fixture'] }, tools: { status: 'pass', evidence: ['fixture'] }, environment: { status: 'pass', evidence: ['fixture'] } },
  decisions: [{ call: 6, status: 'pass', evidence: ['fixture argument and result'] }] }
function admitted(source: ReturnType<typeof fixture>) {
  return curateSession(source, { family: 'fixture', task: 'fixture', trial: 'fixture', rootSession: source.session.id, revision: 'fixture', configurationHash: 'a'.repeat(64),
    review: { kind: 'synthetic-fixture', reviewer: 'fixture', evidence: 'fixture.ts', contentHash: curationSourceHash(source), transformationHash: digest(TRANSFORMATION) } }, grade, policy)
}
function correlation(limit = 4) {
  const mapper = { startCall: vi.fn(), endCall: vi.fn() }, stats = diagnostics()
  const capture = new CallCorrelation(mapper, stats, limit), source = fixture()
  const event = source.events.find(e => e.type === 'assistant/message')!
  if (event.type !== 'assistant/message') throw Error('Missing fixture message')
  const owner = {}, attemptId = LlmAttemptId('attempt')
  const start = () => capture.frame('fixture', owner, { type: 'start', attemptId, revision: 1, turn: 1, step: 1 })
  const end = () => capture.frame('fixture', owner, { type: 'end', attemptId, revision: 2, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: event.seq } })
  const request = { sessionId: source.session.id, provider: 'fixture', model: 'fixture', messages: [] }
  const result = { ended: 2000, blocks: event.data.message.content, finish: 'tool-calls', truncated: false }
  return { mapper, stats, capture, event, start, end, request, result, owner }
}

it('binds one successful dispatch to its explicit settlement, retaining observed times', () => {
  const c = correlation()
  c.start(); c.capture.start('dispatch', c.request, 1000); c.capture.end('dispatch', c.result)
  expect(c.mapper.startCall).not.toHaveBeenCalled()
  c.capture.event('fixture', c.event); c.end()
  expect(c.mapper.startCall.mock.calls[0]).toEqual(['dispatch', c.request, 1000, c.event.seq, undefined, c.event.data.message.id, undefined])
  expect(c.mapper.endCall).toHaveBeenCalledWith('dispatch', c.result)
  expect(c.stats.correlationFailures).toBe(0)
})

it('keeps identical successful dispatches ambiguous rather than guessing a message link', () => {
  const c = correlation(); c.start()
  for (const id of ['one', 'two']) { c.capture.start(id, c.request, 1000); c.capture.end(id, c.result) }
  c.capture.event('fixture', c.event); c.end()
  expect(c.mapper.startCall.mock.calls).toHaveLength(2)
  expect(c.mapper.startCall.mock.calls.every(call => call[5] === undefined)).toBe(true)
  expect(c.stats.correlationFailures).toBe(2)
})

it('releases missing-result dispatches so a later attempt can still correlate at capacity one', () => {
  const c = correlation(1); c.start(); c.capture.start('lost', c.request, 1000); c.end(); c.capture.flush()
  expect(c.mapper.endCall).toHaveBeenCalledWith('lost', expect.objectContaining({ finish: 'incomplete' }))
  c.start(); c.capture.start('next', c.request, 1100); c.capture.end('next', c.result); c.capture.event('fixture', c.event); c.end()
  expect(c.mapper.startCall.mock.calls.at(-1)?.[5]).toBe(c.event.data.message.id)
  expect(c.stats.correlationFailures).toBe(1)
})

it('keeps failed retries separate and refuses settlement from a replaced Agent', () => {
  const c = correlation(); c.start()
  c.capture.start('failed', c.request, 1000); c.capture.end('failed', { ...c.result, finish: 'error', blocks: [] })
  c.capture.start('success', c.request, 1500); c.capture.end('success', c.result); c.capture.event('fixture', c.event)
  c.capture.frame('fixture', {}, { type: 'end', attemptId: LlmAttemptId('attempt'), revision: 2, index: 1, outcome: { kind: 'abandoned' } })
  expect(c.mapper.startCall).not.toHaveBeenCalled(); c.end()
  expect(c.mapper.startCall.mock.calls.map(call => call[5])).toEqual([undefined, c.event.data.message.id])
})

it('serializes asynchronous reads and drains accepted work after overload', async () => {
  const stats = diagnostics(), queue = new CaptureWorkQueue(2, stats), barrier = Promise.withResolvers<void>(), order: number[] = []
  queue.push(async () => { await barrier.promise; order.push(1) })
  queue.push(() => { order.push(2) }); queue.push(() => { order.push(3) })
  const closed = queue.close(); expect(order).toEqual([])
  barrier.resolve(); await closed
  expect(order).toEqual([1, 2]); expect(stats.recordsDropped).toBe(1)
})

it('derives earlier-turn review from a verified trajectory and rejects substituted history', () => {
  const source = fixture(), session = Session.create(source.session.id, source.events, source.session)
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Confirm the value.' }] }), { surfaceOp: 'append' })
  const answer = source.events.findLast(e => e.type === 'assistant/message')!
  if (answer.type !== 'assistant/message') throw Error('Missing answer')
  session.append('assistant/message', { ...answer.data, turn: 2, step: 1, message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: answer.data.message.content }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const snapshot = { ...source, events: [...session.snapshotEvents()] }
  const root = admitted(snapshot), selected = selectToolDecisions(snapshot, root, policy)
  expect(selected.targets).toHaveLength(1)
  expect(selected.targets[0]?.provenance.review?.derivedFrom?.contentHash).toBe(root.provenance.sourceHash)
  const altered = structuredClone(snapshot)
  const user = altered.events.find(e => e.type === 'user/message')!
  if (user.type === 'user/message') user.data = { ...user.data, content: [{ type: 'text', text: 'unreviewed replacement' }] }
  expect(selectToolDecisions(altered, root, policy).rejections[0]?.reason).toContain('differs from reviewed')
})

it('refuses the pre-release V2 fixture and migrates a fully specified synthetic V2 header', async () => {
  const original = await readFile(new URL('./fixtures/recorded-session.v2.json', import.meta.url), 'utf8')
  const v2 = JSON.parse(original) as { session: SessionFormatArtifact['header']; events: SessionFormatArtifact['events']; inheritedEventCount: number }
  expect(() => sessionFormatV2ToV3.migrateHeader(v2.session)).toThrow('delegationDepth')
  // This synthetic input declares its depth; the preserved pre-release file remains untouched and unsupported.
  const syntheticHeader = { ...v2.session, delegationDepth: 0 }
  const header = sessionFormatV2ToV3.migrateHeader(syntheticHeader)
  const stage = sessionFormatV2ToV3.createStage({ sourceHeader: syntheticHeader, targetHeader: header, sourceKind: 'decoded', sourceInheritedEventCount: v2.inheritedEventCount })
  const collector = new SessionFormatEventCollector()
  for (const event of v2.events) stage.transformEvent(event, collector)
  const artifact = restoreReleasedV3Artifact({ header, events: collector.values, inheritedEventCount: stage.finish(collector) }, new Set())
  const events = artifact.events as unknown as SessionEvent[]
  const session = Session.fromRestore(SessionId(String(header.id)), events, header as unknown as import('@deepseek-ai/dsh-session').SessionHeader, SessionLogOffset(artifact.inheritedEventCount), 'detached')
  const before = v2.events.filter(e => e.type === 'assistant/message').map(e => (e.data as { message: { id: string } }).message.id)
  expect(events.flatMap(e => e.type === 'assistant/message' ? [e.data.message.id] : [])).toEqual(before)
  expect(session.header.version).toBe(3)
  expect(events.some(e => e.type === 'system/message')).toBe(true)
  expect(await readFile(new URL('./fixtures/recorded-session.v2.json', import.meta.url), 'utf8')).toBe(original)
})

it('keeps human preference separate from frozen source hashes and task eligibility', () => {
  const source = fixture(), candidate = admitted(source)
  const messageId = source.events.findLast(e => e.type === 'assistant/message')!
  if (messageId.type !== 'assistant/message') throw Error('Missing answer')
  source.events.push({ type: 'feedback/message-put', time: 4000, seq: source.events.length as SessionEvent['seq'], data: { sessionId: source.session.id,
    item: { messageId: messageId.data.message.id, rating: 'negative', version: '00000000-0000-4000-8000-000000000001' as import('@deepseek-ai/dsh-message-feedback').MessageFeedbackVersion, createdAt: 4000, updatedAt: 4000 } } })
  const rated = admitted(source)
  expect(rated.provenance.sourceHash).toBe(candidate.provenance.sourceHash)
  expect(rated.provenance.requestHash).toBe(candidate.provenance.requestHash)
  expect(rated.provenance.rowHash).toBe(candidate.provenance.rowHash)
  expect(rated.humanFeedback?.rating).toBe('negative')
  expect(rated.sftEligible).toBe(candidate.sftEligible)
  expect(rated.trainingReady).toBe(false)
})
