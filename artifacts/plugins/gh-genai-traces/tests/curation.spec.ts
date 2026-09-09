import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { exportFireworksSft, exportFireworksOutcomeSft } from '../src/fireworks.ts'
import { TRANSFORMATION, type Candidate, type Grade } from '../src/curation.ts'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import { describe, expect, it } from 'vitest'
import { curateSession, digest, partitionCandidates, preferencePair, validateTrainingRow, validateCandidate, selectToolDecisions, type Provenance } from '../src/curation.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { fixture } from './fixture.ts'

const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted' }), {})
const sourceFixture = fixture()
const provenance: Provenance = { family: 'read', task: 'read-42', trial: 'read-1', rootSession: 'fixture', revision: 'fixture', configurationHash: 'a'.repeat(64), review: { kind: 'synthetic-fixture', reviewer: 'test', evidence: 'fixture.ts', contentHash: digest(sourceFixture), transformationHash: digest(TRANSFORMATION) } }
const grade: Grade = { version: 'deterministic-v2', required: ['syntax', 'semantics', 'tools', 'environment'], execution: { exitCode: 0, timedOut: false }, observations: { syntax: { status: 'pass', evidence: ['fixture'] }, semantics: { status: 'pass', evidence: ['fixture'] }, tools: { status: 'pass', evidence: ['fixture'] }, environment: { status: 'pass', evidence: ['fixture'] } } }
const candidate = () => curateSession(structuredClone(sourceFixture), structuredClone(provenance), structuredClone(grade), policy)

it('derives outcome-supervised reasoning without rewriting the format-only candidate', () => {
  const source = structuredClone(sourceFixture)
  const target = source.events.findLast(e => e.type === 'assistant/message')!
  if (target.type !== 'assistant/message') throw Error('Missing fixture answer')
  target.data.message.content.unshift({ type: 'reasoning', text: 'The read result contains 42.' })
  const c = { ...curateSession(source, { ...provenance, review: { ...provenance.review!, contentHash: digest(source) } }, grade, policy), split: 'train' as const }
  const original = structuredClone(c)
  const row = exportFireworksOutcomeSft(c)
  expect(row.messages.at(-1)).toMatchObject({ reasoning_content: 'The read result contains 42.', content: 'The value is 42.', weight: 1 })
  expect(row.messages.filter(m => m.role === 'assistant').slice(0, -1).every(m => m.weight === 0)).toBe(true)
  expect(c).toEqual(original)
  expect(exportFireworksSft(c).messages.at(-1)?.reasoning_content).toBeUndefined()
  expect(() => exportFireworksOutcomeSft({ ...c, sftEligible: false })).toThrow('admitted')
  const unassigned: Candidate = { ...c }
  delete unassigned.split
  expect(() => exportFireworksOutcomeSft(unassigned)).toThrow('frozen split')
  const noReasoning = { ...candidate(), split: 'train' as const }
  expect(() => exportFireworksOutcomeSft(noReasoning)).toThrow('reasoning block')
  const corrupt = structuredClone(c)
  corrupt.grade.observations.semantics.status = 'unknown'
  expect(() => exportFireworksOutcomeSft(corrupt)).toThrow('eligibility')
  corrupt.grade = structuredClone(c.grade)
  corrupt.response.content[0] = { type: 'reasoning', text: 'Unreviewed substitution' }
  expect(() => exportFireworksOutcomeSft(corrupt)).toThrow('mismatch')
  target.data.message.content.push({ type: 'text', text: ' Checked.' })
  const multiple = { ...curateSession(source, { ...provenance, review: { ...provenance.review!, contentHash: digest(source) } }, grade, policy), split: 'train' as const }
  expect(exportFireworksOutcomeSft(multiple).messages.at(-1)?.content).toBe('The value is 42. Checked.')
})

it('rejects altered file hashes, stale review, invented readiness and contradictory admission', () => {
  expect(validateCandidate(JSON.parse(JSON.stringify(candidate()))).provenance.rowHash).toBe(candidate().provenance.rowHash)
  const mutations = [
    (c: ReturnType<typeof candidate>) => { c.provenance.rowHash = '0'.repeat(64) },
    (c: ReturnType<typeof candidate>) => { c.provenance.review!.contentHash = '0'.repeat(64) },
    (c: ReturnType<typeof candidate>) => { c.grade.observations.tools.status = 'unknown' },
    (c: ReturnType<typeof candidate>) => { c.target.blocks = [999] },
  ]
  for (const mutate of mutations) { const c = candidate(); mutate(c); expect(() => validateCandidate(c)).toThrow() }
  expect(() => validateCandidate({ ...candidate(), trainingReady: true })).toThrow()
  expect(() => validateCandidate({ ...candidate(), version: 1 })).toThrow()
})

it('selects only independently assessed tool calls and keeps ungraded reasoning unsupervised', () => {
  const event = sourceFixture.events.find(e => e.type === 'assistant/message')!
  const call = sourceFixture.events.find(e => e.type === 'tool/call')!
  const p = { ...provenance, review: { ...provenance.review!, transformationHash: digest({ ...TRANSFORMATION, objective: 'tool-decision' }) } }
  expect(() => curateSession(sourceFixture, p, grade, policy, event.seq)).toThrow('independent')
  const c = curateSession(sourceFixture, p, { ...grade, decisions: [{ call: call.seq, status: 'pass', evidence: ['independent argument and observation check'] }] }, policy, event.seq)
  expect(c.target).toMatchObject({ policy: 'tool-decision', blocks: [0], reasoning: 'omit' })
  expect(c.request.messages).toHaveLength(1)
  expect(validateCandidate(c).target.policy).toBe('tool-decision')
  for (const status of ['fail', 'unknown'] as const) {
    const changed = structuredClone(c)
    changed.grade.decisions![0]!.status = status
    expect(() => validateCandidate(changed)).toThrow('distinct passing decisions')
  }
  expect(() => validateCandidate({ ...c, grade: { ...c.grade, decisions: [] } })).toThrow('distinct passing decisions')
  expect(() => validateCandidate({ ...c, grade: { ...c.grade, decisions: [c.grade.decisions![0], c.grade.decisions![0]] } })).toThrow('distinct passing decisions')
  expect(() => exportFireworksSft(c)).toThrow('loss mask')
})

it('accounts for rejected tool targets including unexpected selection errors', () => {
  const c = candidate(), call = sourceFixture.events.find(e => e.type === 'tool/call')!
  const rejected = selectToolDecisions(sourceFixture, c, policy)
  expect(rejected.considered).toBe(1)
  expect(rejected.targets).toHaveLength(0)
  expect(rejected.rejections).toHaveLength(1)
  expect(rejected.rejections[0]?.reason).toContain('independent passing grade')
  c.grade.decisions = [{ call: call.seq, status: 'pass', evidence: ['independent tool evidence'] }]
  expect(selectToolDecisions(sourceFixture, c, policy).targets).toHaveLength(1)
  const broken = new ContentPolicy(resolveConfig({ content: 'rich-redacted' }), {})
  broken.attributes = () => { throw new TypeError('selection implementation failed') }
  expect(selectToolDecisions(sourceFixture, c, broken).rejections).toEqual([{ session: sourceFixture.session.id,
    event: sourceFixture.events.find(e => e.type === 'assistant/message')!.seq, reason: 'TypeError: selection implementation failed' }])
  expect(selectToolDecisions(sourceFixture, undefined, policy).rejections[0]?.reason).toContain('no eligible')
})

it('supervises independently graded tool decisions and rejects unresolved history or unknown tools', () => {
  const source = structuredClone(sourceFixture)
  const target = source.events.find(e => e.type === 'assistant/message')!
  const call = source.events.find(e => e.type === 'tool/call')!
  if (target.type !== 'assistant/message') throw Error('Missing fixture tool decision')
  target.data.message.content.unshift({ type: 'reasoning', text: 'Read the requested fixture before answering.' })
  const p = { ...provenance, review: { ...provenance.review!, contentHash: digest(source), transformationHash: digest({ ...TRANSFORMATION, objective: 'tool-decision' }) } }
  const g = { ...grade, decisions: [{ call: call.seq, status: 'pass' as const, evidence: ['fixture arguments and result independently checked'] }] }
  const c = { ...curateSession(source, p, g, policy, target.seq), split: 'train' as const }
  const row = exportFireworksOutcomeSft(c)
  expect(row.messages.at(-1)).toMatchObject({ weight: 1, content: '', reasoning_content: 'Read the requested fixture before answering.', tool_calls: [{ function: { name: 'read' } }] })
  const substituted = structuredClone(c)
  substituted.grade.decisions![0]!.status = 'fail'
  substituted.grade.decisions!.push({ call: call.seq + 100, status: 'pass', evidence: ['unrelated later action'] })
  expect(() => exportFireworksOutcomeSft(substituted)).toThrow('bound passing grade')
  const wrongCall = structuredClone(c)
  wrongCall.sourceEvidence.toolDecisions![0]!.callId = 'different-call'
  expect(() => validateCandidate(wrongCall)).toThrow('bound passing grade')
  expect(() => validateTrainingRow(row)).toThrow()
  const broken = structuredClone(row)
  broken.messages.at(-1)!.tool_calls![0]!.function.name = 'missing'
  expect(() => validateTrainingRow(broken, 'tool-decision')).toThrow('Unknown tool')
  const unresolved = structuredClone(row)
  unresolved.messages.splice(-1, 0, { ...structuredClone(row.messages.at(-1)!), weight: 0 })
  expect(() => validateTrainingRow(unresolved, 'tool-decision')).toThrow('Missing tool results')
  c.grade.decisions![0]!.status = 'fail'
  expect(() => exportFireworksOutcomeSft(c)).toThrow('passing decisions')
})

describe('canonical curation', () => {
  it('retains tool pairing and masks every earlier assistant message', () => {
    const c = candidate()
    expect(exportFireworksSft(c).messages.filter(m => m.role === 'assistant').map(m => m.weight)).toEqual([0, 1])
    expect(exportFireworksSft(c).messages.find(m => m.role === 'tool')?.tool_call_id).toBe('call-read')
    expect(c.provenance.requestHash).toBe(digest(c.request))
    expect(c.provenance.requestedReasoningEffort).toBeNull()
    expect(c.sftEligible).toBe(true)
    expect(c.trainingReady).toBe(false)
  })
  it('retains task failure separately from complete capture', () => {
    const c = curateSession(structuredClone(sourceFixture), provenance, { ...grade, observations: { ...grade.observations, semantics: { status: 'fail' as const, evidence: ['wrong answer'] } } }, policy)
    expect(c.sftEligible).toBe(false)
    expect(exportFireworksSft(c).messages.at(-1)?.content).toBe('The value is 42.')
  })
  it('rejects missing completion, privacy review, content truncation, and actual redaction', () => {
    const source = fixture()
    expect(() => curateSession({ ...source, events: source.events.slice(0, -1) }, provenance, grade, policy)).toThrow('turn')
    expect(() => curateSession(source, { ...provenance, review: null }, grade, policy)).toThrow('Privacy')
    expect(() => curateSession(source, provenance, grade, new ContentPolicy(resolveConfig({ content: 'rich-redacted', maxContentBytes: 8 }), {}))).toThrow('truncated')
    expect(() => curateSession(source, provenance, grade, new ContentPolicy(resolveConfig({ content: 'rich-redacted', secretEnv: ['KEY'] }), { KEY: '42' }))).toThrow('redacted')
  })
  it.each([
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages.find(m => m.role === 'tool')!.tool_call_id = 'missing' },
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages.find(m => m.tool_calls)!.tool_calls![0]!.function.arguments = '{' },
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages.find(m => m.tool_calls)!.tool_calls![0]!.function.name = 'undeclared' },
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages.find(m => m.role === 'assistant')!.weight = 1 },
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages.at(-1)!.content = '' },
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages = row.messages.filter(m => m.role !== 'user') },
    (row: ReturnType<typeof exportFireworksSft>) => { row.messages.splice(2, 0, { role: 'system', content: 'late' }) },
  ])('rejects invalid serialized row %#', mutate => {
    const row = exportFireworksSft(candidate())
    mutate(row)
    expect(() => validateTrainingRow(JSON.parse(JSON.stringify(row)))).toThrow()
  })
  it('keeps family, ancestor sessions, and duplicate requests in the held-out split', () => {
    const a = candidate()
    const b = structuredClone(a)
    b.provenance = { ...b.provenance, family: 'heldout', trial: 'child', session: 'child', rootSession: 'other', parentSession: SessionId('fixture') }
    const rows = partitionCandidates([a, b], [{ keys: ['family:heldout'], split: 'test', version: 'phoenix-task-v1' }])
    expect(rows.map(row => row.split)).toEqual(['test', 'test'])
    expect(rows[1]!.duplicateOf).toBe('read-1')
  })
  it('keeps identical rows with different request configurations out of training when held out', () => {
    const a = candidate()
    const b = structuredClone(a)
    b.provenance = { ...b.provenance, family: 'heldout', session: 'independent', rootSession: 'independent', requestHash: digest('other-config') }
    expect(partitionCandidates([a, b], [{ keys: ['family:heldout'], split: 'test', version: 'phoenix-task-v1' }]).map(row => row.split)).toEqual(['test', 'test'])
  })
  it('refuses same-task preference pairs with different request content or unsupported tools', () => {
    const a = candidate()
    const b = { ...candidate(), sftEligible: false, grade: { ...grade, observations: { ...grade.observations, semantics: { status: 'fail' as const, evidence: ['wrong answer'] } } } }
    expect(() => preferencePair(a, b)).toThrow('without tools')
    b.provenance.requestHash = digest('different')
    expect(() => preferencePair(a, b)).toThrow('differ')
  })
  it('admits a strict one-turn preference and rejects identical outputs', () => {
    const a = candidate()
    a.request = { messages: [createUserMessage({ content: [{ type: 'text', text: '2+2?' }], source: { kind: 'user' } })], config: { provider: 'fixture', model: 'fixture' } }
    a.response = { ...a.response, content: [{ type: 'text', text: '4' }] }
    a.provenance.requestHash = digest(a.request)
    const b = structuredClone(a)
    b.grade.observations.semantics = { status: 'fail', evidence: ['wrong answer'] }
    b.sftEligible = false
    expect(() => preferencePair(a, b)).toThrow('Identical')
    b.response = { ...b.response, content: [{ type: 'text', text: '5' }] }
    expect(preferencePair(a, b).non_preferred_output[0]!.content).toBe('5')
  })
})

it('blocks unknown required evidence and quarantines connected promoted split conflicts', () => {
  const c = candidate()
  const unknown = structuredClone(grade)
  unknown.observations.environment = { status: 'unknown', evidence: ['not observed'] }
  expect(curateSession(structuredClone(sourceFixture), provenance, unknown, policy).sftEligible).toBe(false)
  const rows = partitionCandidates([c], [
    { keys: ['family:read'], split: 'train', version: 'old-train' },
    { keys: [`output:${c.provenance.outputHash}`], split: 'test', version: 'old-test' },
  ])
  expect(rows[0]).toMatchObject({ split: null, sftEligible: false, conflictVersions: ['old-train', 'old-test'] })
})

it('retains approval evidence and excludes human-assisted trajectories from promotion', () => {
  const source = structuredClone(sourceFixture)
  const session = Session.create(source.session.id, source.events, source.session)
  session.append('approval/asked', { id: ApprovalRequestId('review'), toolName: 'write' })
  session.append('approval/decided', { id: ApprovalRequestId('review'), outcome: 'allowed-once' })
  source.events = [...session.snapshotEvents()]
  const c = curateSession(source, { ...provenance, review: { ...provenance.review!, contentHash: digest(source) } }, grade, policy)
  expect(c.sourceEvidence.approvals).toHaveLength(2)
  expect(c.sourceEvidence.approvalPolicy).toBe('exclude-human-intervention')
  expect(c.sftEligible).toBe(false)
})

it('reconstructs a compacted request from the upstream replacement while retaining original evidence', () => {
  const source = structuredClone(sourceFixture), original = JSON.stringify(source.events)
  const session = Session.create(source.session.id, source.events, source.session)
  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Compacted context: the observed value is 42.' }], source: { kind: 'plugin', plugin: 'fixture-compaction' } }),
    { surfaceOp: { op: 'replace', start: SessionSeq(1), end: SessionSeq(9) }, sourceEventSeqs: [1, 4, 6, 9].map(SessionSeq) })
  session.append('step/start', { turn: 2, step: 1 })
  const block = { type: 'text' as const, text: '42' }
  session.append('assistant/message', { turn: 2, step: 1, message: createAssistantMessage({ content: [block], source: { provider: 'fixture', model: 'fixture' } }), stream: [
    { type: 'chunk', time: 2000, chunk: { type: 'block-end', index: 0, block } },
    { type: 'chunk', time: 2001, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ] }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const compacted = { ...source, events: [...session.snapshotEvents()] }
  const c = curateSession(compacted, { ...provenance, review: { ...provenance.review!, contentHash: digest(compacted) } }, grade, policy)
  expect(c.request.messages).toHaveLength(1)
  expect(c.request.messages[0]!.content).toEqual([{ type: 'text', text: 'Compacted context: the observed value is 42.' }])
  expect(JSON.stringify(source.events)).toBe(original)
  const corrupt = structuredClone(compacted)
  const replacement = corrupt.events.filter(e => e.type === 'user/message').find(e => typeof e.surfaceOp === 'object')!
  replacement.sourceEventSeqs = [SessionSeq(1)]
  expect(() => curateSession(corrupt, provenance, grade, policy)).toThrow()
})
