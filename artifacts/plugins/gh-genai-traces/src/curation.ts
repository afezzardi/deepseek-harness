/** Versioned backend-neutral candidates reconstructed from canonical sessions. */
import type {} from '@deepseek-ai/dsh-user-approval/types'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { expandAssistantStream, type Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, foldRequestHeader, foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { ContentPolicy } from './content.ts'
export { validateTrainingRow, preferencePair } from './fireworks.ts'
export type { TrainingRow } from './fireworks.ts'

const dimension = z.enum(['syntax', 'semantics', 'tools', 'environment'])
/** An observation never substitutes execution status for task evidence. */
export const observationSchema = z.object({ status: z.enum(['pass', 'fail', 'unknown', 'not-applicable']), evidence: z.array(z.string()).min(1) }).strict()
/** Required dimensions belong to the task definition, including explicit missing evidence. */
export const gradeSchema = z.object({ version: z.string().min(1), required: z.array(dimension).min(1),
  observations: z.object({ syntax: observationSchema, semantics: observationSchema, tools: observationSchema, environment: observationSchema }).strict(),
  execution: z.object({ exitCode: z.number().nullable(), timedOut: z.boolean().nullable() }).strict(),
}).strict()
/** Content review is bound to an exact source and transformation, never a blanket label. */
export const reviewSchema = z.object({ kind: z.enum(['synthetic-fixture', 'explicit-review']), reviewer: z.string().min(1), evidence: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), transformationHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
/** Independently supplied task, configuration, and privacy evidence. */
export const provenanceSchema = z.object({ family: z.string().min(1), task: z.string().min(1), trial: z.string().min(1),
  rootSession: z.string().min(1), revision: z.string().min(1), configurationHash: z.string().regex(/^[a-f0-9]{64}$/), review: reviewSchema.nullable(),
}).strict()
/** Versioned assessment, with unknown distinct from failure. */
export type Grade = z.infer<typeof gradeSchema>
/** Required provenance supplied by the campaign, not inferred from the answer. */
export type Provenance = z.infer<typeof provenanceSchema>
/** Explicit transformation identity used by privacy review and checkpoints. */
export const TRANSFORMATION = { version: 2, reconstruction: 'upstream-surface', objective: 'final-answer', reasoning: 'retain-source-omit-target' } as const

/** Hash normalized JSON; array order is significant.
 * @param value - serializable data.
 * @returns stable SHA-256 digest.
 */
export function digest(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, member: unknown) => member && typeof member === 'object' && !Array.isArray(member)
    ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member)
  if (encoded === undefined) throw Error('Unserializable hash input')
  return createHash('sha256').update(encoded).digest('hex')
}

function validateMessages(messages: readonly Message[], names: Set<string>): void {
  const pending = new Set<string>(), used = new Set<string>()
  for (const message of messages) {
    if (pending.size && message.source.kind !== 'tool') throw Error('Missing tool results')
    for (const block of message.content) {
      if (block.type === 'tool-call') {
        if (message.role !== 'assistant' || !names.has(block.name) || used.has(block.id)) throw Error('Invalid tool call identity')
        const args: unknown = JSON.parse(block.arguments)
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Tool arguments must be a JSON object')
        used.add(block.id); pending.add(block.id)
      }
      if (block.type === 'tool-result' && (message.source.kind !== 'tool' || !pending.delete(block.toolCallId))) throw Error('Unpaired tool result')
    }
  }
  if (pending.size) throw Error('Unsettled tools')
}

/** Reconstruct a complete final answer without selecting ungraded intermediate actions.
 * @param snapshot - upstream-validated history with its inherited prefix.
 * @param provenance - task identity and exact content review.
 * @param grade - independent required observations.
 * @param policy - capture completeness and credential policy.
 * @returns neutral candidate; unknown grades block promotion.
 */
export function curateSession(snapshot: SessionLogSnapshot, provenance: Provenance, grade: Grade, policy: ContentPolicy) {
  provenanceSchema.parse(provenance); gradeSchema.parse(grade)
  const target = snapshot.events.findLast(event => event.type === 'assistant/message')
  const terminal = snapshot.events.findLast(event => event.type === 'turn/end')
  if (!target || target.type !== 'assistant/message' || target.seq < snapshot.inheritedEventCount) throw Error('Missing owned final answer')
  if (!terminal || terminal.type !== 'turn/end' || terminal.seq < target.seq || terminal.data.turn !== target.data.turn || terminal.data.reason.kind !== 'completed') throw Error('Incomplete or failed turn')
  const finish = expandAssistantStream(target.data.stream).findLast(chunk => chunk.chunk.type === 'finish')?.chunk
  if (finish?.type !== 'finish' || finish.reason.kind !== 'stop') throw Error('Truncated or incomplete target')
  const prefix = snapshot.events.slice(0, target.seq), header = foldRequestHeader(prefix)
  if (!header) throw Error('Missing request header')
  const messages = foldSurface(prefix).nodes.flatMap(seq => {
    const event = prefix[seq], message = event ? deriveEventMessage(event) : null
    return message ? [message] : []
  })
  const request = structuredClone({ ...header, messages })
  const response = structuredClone(target.data.message)
  const names = new Set(header.tools?.map(tool => tool.name))
  if (names.size !== (header.tools?.length ?? 0)) throw Error('Duplicate tool definition')
  validateMessages([...messages, response], names)
  const blocks = response.content.flatMap((block, index) => block.type === 'text' && block.text.trim() ? [index] : [])
  if (!blocks.length || response.content.some(block => block.type === 'tool-call')) throw Error('Missing final text answer')
  const capture = policy.attributes('candidate', { request, response })
  if (capture['gh.content.candidate.status'] !== 'complete') throw Error(`Capture ${String(capture['gh.content.candidate.status'])}`)
  const sourceHash = digest(snapshot), transformationHash = digest(TRANSFORMATION)
  if (!provenance.review || provenance.review.contentHash !== sourceHash || provenance.review.transformationHash !== transformationHash) throw Error('Privacy review missing or stale')
  const selection = { policy: 'final-answer' as 'final-answer' | 'tool-decision', event: target.seq, blocks, reasoning: 'omit' as 'omit' | 'masked' | 'supervise' }
  const approvals = snapshot.events.filter(event => event.type === 'approval/asked' || event.type === 'approval/decided')
  const eligible = grade.required.every(key => grade.observations[key].status === 'pass') && approvals.length === 0
  return { version: 2 as const, request, response, target: selection, grade, provenance: { ...provenance,
    session: String(snapshot.session.id), parentSession: snapshot.session.parentSession ?? null, sessionVersion: snapshot.session.version,
    inheritedEventCount: snapshot.inheritedEventCount, sourceEvent: target.seq, sourceHash, transformationHash,
    requestHash: digest(request), toolsHash: digest(header.tools ?? null), configHash: digest(header.config),
    requestedSettings: Object.fromEntries(Object.entries(header.config).filter(([key]) => !Object.hasOwn(header.adapterDefaults ?? {}, key))), adapterDefaults: header.adapterDefaults ?? null, observedWireSettings: null, modelAlias: header.config.model,
    requestedReasoningEffort: header.adapterDefaults?.reasoningEffort ? null : header.config.reasoningEffort ?? null,
    rowHash: digest({ request, response, target: { ...selection, event: null } }), outputHash: digest(response.content),
    renderer: null, tokenizer: null, checkpoint: null,
  }, sourceEvidence: { approvalPolicy: 'exclude-human-intervention', approvals, events: snapshot.events.filter(event => event.type === 'tool/result' && event.data.error || event.type === 'assistant/attempt'),
    reconstruction: 'reconstruction' in snapshot ? snapshot.reconstruction : null },
  sftEligible: eligible, trainingReady: false as const,
  readiness: { qwen: { schema: 'unverified', renderer: 'unverified' }, fireworks: { schema: 'unverified', renderer: 'unverified' } } }
}
/** Shared candidate for all destinations; version-1 files remain historical evidence. */
export type Candidate = ReturnType<typeof curateSession>

/** Phoenix-owned assignments pinned to an immutable promoted version. */
export interface SplitAssignment { keys: string[]; split: 'train' | 'validation' | 'test'; version: string }

/** Group linked evidence and quarantine conflicts without relabelling promoted examples.
 * @param candidates - newly observed evidence.
 * @param assignments - native Phoenix splits read at pinned dataset versions, or the frozen initial task version.
 * @returns deduplicated candidates with conflict versions; unassigned groups cannot promote.
 */
export function partitionCandidates(candidates: readonly Candidate[], assignments: readonly SplitAssignment[]) {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = key
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
    while (parent.has(key) && parent.get(key) !== root) { const next = parent.get(key)!; parent.set(key, root); key = next }
    parent.set(root, root); return root
  }
  const join = (keys: string[]) => { for (const key of keys.slice(1)) parent.set(find(key), find(keys[0]!)) }
  const keys = (c: Candidate) => { const p = c.provenance; return [`family:${p.family}`, `task:${p.task}`, `session:${p.session}`, `session:${p.rootSession}`, ...p.parentSession ? [`session:${p.parentSession}`] : [], `request:${p.requestHash}`, `row:${p.rowHash}`, ...c.sftEligible ? [`output:${p.outputHash}`] : []] }
  candidates.forEach(c => join(keys(c))); assignments.forEach(a => join(a.keys))
  const memberships = new Map<string, SplitAssignment[]>()
  for (const a of assignments) { const key = find(a.keys[0]!); memberships.set(key, [...memberships.get(key) ?? [], a]) }
  const seen = new Map<string, string>()
  return candidates.map(candidate => {
    const existing = memberships.get(find(keys(candidate)[0]!)) ?? [], splits = new Set(existing.map(a => a.split))
    const split = splits.size === 1 ? existing[0]!.split : null
    const conflictVersions = splits.size > 1 ? [...new Set(existing.map(a => a.version))] : []
    const duplicateOf = seen.get(candidate.provenance.rowHash) ?? null
    if (!duplicateOf) seen.set(candidate.provenance.rowHash, candidate.provenance.trial)
    return { ...candidate, split, conflictVersions, duplicateOf, sftEligible: candidate.sftEligible && split !== null }
  })
}
