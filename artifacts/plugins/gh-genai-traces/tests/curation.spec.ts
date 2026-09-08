import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { exportFireworksSft } from '../src/fireworks.ts'
import { TRANSFORMATION, type Grade } from '../src/curation.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import { describe, expect, it } from 'vitest'
import { curateSession, digest, partitionCandidates, preferencePair, validateTrainingRow, type Provenance } from '../src/curation.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { fixture } from './fixture.ts'

const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted' }), {})
const sourceFixture = fixture()
const provenance: Provenance = { family: 'read', task: 'read-42', trial: 'read-1', rootSession: 'fixture', revision: 'fixture', configurationHash: 'a'.repeat(64), review: { kind: 'synthetic-fixture', reviewer: 'test', evidence: 'fixture.ts', contentHash: digest(sourceFixture), transformationHash: digest(TRANSFORMATION) } }
const grade: Grade = { version: 'deterministic-v2', required: ['syntax', 'semantics', 'tools', 'environment'], execution: { exitCode: 0, timedOut: false }, observations: { syntax: { status: 'pass', evidence: ['fixture'] }, semantics: { status: 'pass', evidence: ['fixture'] }, tools: { status: 'pass', evidence: ['fixture'] }, environment: { status: 'pass', evidence: ['fixture'] } } }
const candidate = () => curateSession(structuredClone(sourceFixture), provenance, grade, policy)

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
