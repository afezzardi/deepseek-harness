import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { curateSession, digest, partitionCandidates, preferencePair, validateTrainingRow, type Provenance } from '../src/curation.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { fixture } from './fixture.ts'

const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted' }), {})
const provenance: Provenance = { family: 'read', task: 'read-42', trial: 'read-1', rootSession: 'fixture', revision: 'fixture', configurationHash: 'a'.repeat(64), privacy: 'synthetic-reviewed' }
const grade = { version: 'deterministic-v1', syntax: true, semantics: true, tools: true, environment: true }
const candidate = () => curateSession(fixture(), provenance, grade, policy)

describe('canonical curation', () => {
  it('retains tool pairing and masks every earlier assistant message', () => {
    const c = candidate()
    expect(c.row.messages.filter(m => m.role === 'assistant').map(m => m.weight)).toEqual([0, 1])
    expect(c.row.messages.find(m => m.role === 'tool')?.tool_call_id).toBe('call-read')
    expect(c.provenance.requestHash).toBe(digest(c.frozenRequest))
    expect(c.provenance.requestedReasoningEffort).toBeNull()
    expect(c.sftEligible).toBe(true)
    expect(c.trainingReady).toBe(false)
  })
  it('retains task failure separately from complete capture', () => {
    const c = curateSession(fixture(), provenance, { ...grade, semantics: false }, policy)
    expect(c.sftEligible).toBe(false)
    expect(c.row.messages.at(-1)?.content).toBe('The value is 42.')
  })
  it('rejects missing completion, privacy review, content truncation, and actual redaction', () => {
    const source = fixture()
    expect(() => curateSession({ ...source, events: source.events.slice(0, -1) }, provenance, grade, policy)).toThrow('turn')
    expect(() => curateSession(source, { ...provenance, privacy: 'unreviewed' }, grade, policy)).toThrow('Privacy')
    expect(() => curateSession(source, provenance, grade, new ContentPolicy(resolveConfig({ content: 'rich-redacted', maxContentBytes: 8 }), {}))).toThrow('truncated')
    expect(() => curateSession(source, provenance, grade, new ContentPolicy(resolveConfig({ content: 'rich-redacted', secretEnv: ['KEY'] }), { KEY: '42' }))).toThrow('redacted')
  })
  it.each([
    (row: ReturnType<typeof candidate>['row']) => { row.messages.find(m => m.role === 'tool')!.tool_call_id = 'missing' },
    (row: ReturnType<typeof candidate>['row']) => { row.messages.find(m => m.tool_calls)!.tool_calls![0]!.function.arguments = '{' },
    (row: ReturnType<typeof candidate>['row']) => { row.messages.find(m => m.tool_calls)!.tool_calls![0]!.function.name = 'undeclared' },
    (row: ReturnType<typeof candidate>['row']) => { row.messages.find(m => m.role === 'assistant')!.weight = 1 },
    (row: ReturnType<typeof candidate>['row']) => { row.messages.at(-1)!.content = '' },
    (row: ReturnType<typeof candidate>['row']) => { row.messages = row.messages.filter(m => m.role !== 'user') },
    (row: ReturnType<typeof candidate>['row']) => { row.messages.splice(2, 0, { role: 'system', content: 'late' }) },
  ])('rejects invalid serialized row %#', mutate => {
    const row = candidate().row
    mutate(row)
    expect(() => validateTrainingRow(JSON.parse(JSON.stringify(row)))).toThrow()
  })
  it('keeps family, ancestor sessions, and duplicate requests in the held-out split', () => {
    const a = candidate()
    const b = structuredClone(a)
    b.provenance = { ...b.provenance, family: 'heldout', trial: 'child', session: 'child', rootSession: 'other', parentSession: SessionId('fixture') }
    const rows = partitionCandidates([a, b], ['heldout'], [])
    expect(rows.map(row => row.split)).toEqual(['test', 'test'])
    expect(rows[1]!.duplicateOf).toBe('read-1')
  })
  it('keeps identical rows with different request configurations out of training when held out', () => {
    const a = candidate()
    const b = structuredClone(a)
    b.provenance = { ...b.provenance, family: 'heldout', session: 'independent', rootSession: 'independent', requestHash: digest('other-config') }
    expect(partitionCandidates([a, b], ['heldout'], []).map(row => row.split)).toEqual(['test', 'test'])
  })
  it('refuses same-task preference pairs with different request content or unsupported tools', () => {
    const a = candidate()
    const b = { ...candidate(), sftEligible: false, grade: { ...grade, semantics: false } }
    expect(() => preferencePair(a, b)).toThrow('without tools')
    b.provenance.requestHash = digest('different')
    expect(() => preferencePair(a, b)).toThrow('differ')
  })
  it('admits a strict one-turn preference and rejects identical outputs', () => {
    const a = candidate()
    a.row = { messages: [{ role: 'user', content: '2+2?' }, { role: 'assistant', content: '4', weight: 1 }] }
    a.frozenRequest = { messages: [a.row.messages[0]!], config: { provider: 'fixture', model: 'fixture' } }
    a.provenance.requestHash = digest(a.frozenRequest)
    const b = structuredClone(a)
    b.grade.semantics = false
    b.sftEligible = false
    expect(() => preferencePair(a, b)).toThrow('Identical')
    b.row.messages[1]!.content = '5'
    expect(preferencePair(a, b).non_preferred_output[0]!.content).toBe('5')
  })
})
