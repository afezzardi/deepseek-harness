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
  decisions: z.array(z.object({ call: z.number().int().nonnegative(), status: z.enum(['pass', 'fail', 'unknown']), evidence: z.array(z.string()).min(1) }).strict()).optional(),
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

/** Reconstruct a final answer or independently graded tool decision.
 * @param snapshot - upstream-validated history with its inherited prefix.
 * @param provenance - task identity and exact content review.
 * @param grade - independent required observations.
 * @param policy - capture completeness and credential policy.
 * @param selectedEvent - owned assistant event in the terminal completed turn; omission selects the final answer.
 * @returns neutral candidate; unknown grades block promotion.
 */
export function curateSession(snapshot: SessionLogSnapshot, provenance: Provenance, grade: Grade, policy: ContentPolicy, selectedEvent?: number) {
  provenanceSchema.parse(provenance); gradeSchema.parse(grade)
  const target = selectedEvent === undefined ? snapshot.events.findLast(event => event.type === 'assistant/message') : snapshot.events[selectedEvent]
  const terminal = snapshot.events.findLast(event => event.type === 'turn/end')
  if (!target || target.type !== 'assistant/message' || target.seq < snapshot.inheritedEventCount) throw Error('Missing owned assistant target')
  if (selectedEvent !== undefined && terminal?.type === 'turn/end' && terminal.data.turn !== target.data.turn) throw Error('Tool-decision selection is limited to the terminal completed turn')
  if (!terminal || terminal.type !== 'turn/end' || terminal.seq < target.seq || terminal.data.turn !== target.data.turn || terminal.data.reason.kind !== 'completed') throw Error('Incomplete or failed turn')
  const finish = expandAssistantStream(target.data.stream).findLast(chunk => chunk.chunk.type === 'finish')?.chunk
  const objective = selectedEvent === undefined ? 'final-answer' : 'tool-decision'
  if (finish?.type !== 'finish' || finish.reason.kind !== (objective === 'final-answer' ? 'stop' : 'tool-calls')) throw Error('Truncated or incomplete target')
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
  validateMessages(messages, names)
  const blocks = response.content.flatMap((block, index) => objective === 'final-answer' ? block.type === 'text' && block.text.trim() ? [index] : [] : block.type === 'tool-call' ? [index] : [])
  if (!blocks.length || objective === 'final-answer' && response.content.some(block => block.type === 'tool-call')) throw Error('Missing selected target')
  if (objective === 'tool-decision') {
    const settlements: Message[] = []
    if (response.content.some(block => block.type !== 'tool-call' && block.type !== 'reasoning')) throw Error('Mixed tool/text target is unsupported')
    for (const block of response.content) {
      if (block.type !== 'tool-call') continue
      const call = snapshot.events.find(event => event.type === 'tool/call' && event.data.callId === block.id && event.seq > target.seq)
      if (!call || call.type !== 'tool/call' || call.data.name !== block.name || call.data.arguments !== block.arguments || !grade.decisions?.some(d => d.call === call.seq && d.status === 'pass')) throw Error('Selected tool decision has no independent passing grade')
      const result = snapshot.events.find(event => event.type === 'tool/result' && event.data.message.content[0].toolCallId === block.id && event.seq > call.seq)
      if (!result || result.type !== 'tool/result') throw Error('Selected tool result missing')
      settlements.push(result.data.message)
    }
    validateMessages([...messages, response, ...settlements], names)
  } else validateMessages([...messages, response], names)
  const capture = policy.attributes('candidate', { request, response })
  if (capture['gh.content.candidate.status'] !== 'complete') throw Error(`Capture ${String(capture['gh.content.candidate.status'])}`)
  const sourceHash = digest(snapshot), transformationHash = digest({ ...TRANSFORMATION, objective })
  if (!provenance.review || provenance.review.contentHash !== sourceHash || provenance.review.transformationHash !== transformationHash) throw Error('Privacy review missing or stale')
  const selection = { policy: objective, event: target.seq, blocks, reasoning: 'omit' as 'omit' | 'masked' | 'supervise' }
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

/** Record every owned tool-call assistant event, including unsupported or failed selections.
 * @param snapshot - canonical source containing potential targets.
 * @param candidate - independently admitted final-answer candidate, if available.
 * @param policy - capture completeness and credential policy.
 * @returns selected targets and per-event diagnostic rejections.
 */
export function selectToolDecisions(snapshot: SessionLogSnapshot, candidate: Candidate | undefined, policy: ContentPolicy) {
  const events = snapshot.events.filter(event => event.seq >= snapshot.inheritedEventCount && event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'tool-call'))
  const targets: Candidate[] = [], rejections: { session: string; event: number; reason: string }[] = []
  for (const event of events) {
    try {
      if (!candidate?.sftEligible) throw Error('Root trajectory has no eligible final-answer candidate')
      const p = candidate.provenance
      targets.push(curateSession(snapshot, { family: p.family, task: p.task, trial: p.trial, rootSession: p.rootSession, revision: p.revision,
        configurationHash: p.configurationHash, review: { ...p.review!, transformationHash: digest({ ...TRANSFORMATION, objective: 'tool-decision' }) } }, candidate.grade, policy, event.seq))
    } catch (error) { rejections.push({ session: snapshot.session.id, event: event.seq, reason: String(error) }) }
  }
  return { considered: events.length, targets, rejections }
}

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const textBlock = z.looseObject({ type: z.literal('text'), text: z.string() })
const storedBlock = z.discriminatedUnion('type', [textBlock, z.looseObject({ type: z.literal('reasoning'), text: z.string() }),
  z.looseObject({ type: z.literal('tool-call'), id: z.string().min(1), name: z.string().min(1), arguments: z.string() }),
  z.looseObject({ type: z.literal('tool-result'), toolCallId: z.string().min(1), content: z.array(textBlock), isError: z.boolean().optional() }),
])
const storedMessage = z.looseObject({ role: z.enum(['system', 'user', 'assistant']), source: z.looseObject({ kind: z.string() }), content: z.array(storedBlock).min(1) })
const candidateFileSchema = z.looseObject({ version: z.literal(2),
  request: z.looseObject({ config: z.looseObject({ provider: z.string(), model: z.string() }), messages: z.array(storedMessage),
    system: z.string().optional(), tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()) })).optional() }),
  response: storedMessage, target: z.object({ policy: z.enum(['final-answer', 'tool-decision']), event: z.number().int().nonnegative(),
    blocks: z.array(z.number().int().nonnegative()).min(1), reasoning: z.literal('omit') }).strict(), grade: gradeSchema,
  provenance: provenanceSchema.safeExtend({ session: z.string().min(1), parentSession: z.string().nullable(), sessionVersion: z.number().int(),
    inheritedEventCount: z.number().int().nonnegative(), sourceEvent: z.number().int().nonnegative(), sourceHash: hash, transformationHash: hash,
    requestHash: hash, toolsHash: hash, configHash: hash, rowHash: hash, outputHash: hash,
    requestedSettings: z.record(z.string(), z.json()), adapterDefaults: z.record(z.string(), z.literal(true)).nullable(), observedWireSettings: z.null(),
    modelAlias: z.string(), requestedReasoningEffort: z.string().nullable(), renderer: z.null(), tokenizer: z.null(), checkpoint: z.null(),
  }).loose(),
  sourceEvidence: z.looseObject({ approvalPolicy: z.literal('exclude-human-intervention'), approvals: z.array(z.unknown()), events: z.array(z.unknown()) }),
  sftEligible: z.boolean(), trainingReady: z.literal(false), readiness: z.object({
    qwen: z.object({ schema: z.literal('unverified'), renderer: z.literal('unverified') }),
    fireworks: z.object({ schema: z.literal('unverified'), renderer: z.literal('unverified') }),
  }), split: z.enum(['train', 'validation', 'test']).nullable().optional(), conflictVersions: z.array(z.string()).optional(), duplicateOf: z.string().nullable().optional(),
})

/** Validate a candidate read from JSON, including internally recomputable evidence.
 * @param input - untrusted candidate file; validation does not authenticate its reviewer.
 * @returns a candidate whose hashes, selection and admission claims agree.
 */
export function validateCandidate(input: unknown): Candidate {
  const c = candidateFileSchema.parse(input), p = c.provenance
  const hashes = { requestHash: digest(c.request), toolsHash: digest(c.request.tools ?? null), configHash: digest(c.request.config),
    rowHash: digest({ request: c.request, response: c.response, target: { ...c.target, event: null } }), outputHash: digest(c.response.content),
    transformationHash: digest({ ...TRANSFORMATION, objective: c.target.policy }) }
  for (const [key, value] of Object.entries(hashes)) if (p[key] !== value) throw Error(`Candidate ${key} mismatch`)
  if (!p.review || p.review.contentHash !== p.sourceHash || p.review.transformationHash !== p.transformationHash) throw Error('Candidate review mismatch')
  if (c.response.role !== 'assistant' || p.sourceEvent !== c.target.event || c.target.event < p.inheritedEventCount) throw Error('Candidate target ownership mismatch')
  if (c.response.source.kind !== 'model' || p.modelAlias !== c.request.config.model) throw Error('Candidate model identity mismatch')
  const blocks = c.response.content.flatMap((block, index) => c.target.policy === 'final-answer'
    ? block.type === 'text' && typeof block.text === 'string' && block.text.trim() ? [index] : [] : block.type === 'tool-call' ? [index] : [])
  if (digest(blocks) !== digest(c.target.blocks)) throw Error('Candidate target blocks mismatch')
  if (new Set(c.grade.required).size !== c.grade.required.length) throw Error('Duplicate required grade')
  if (c.target.policy === 'tool-decision') {
    const decisions = c.grade.decisions ?? []
    if (new Set(decisions.map(d => d.call)).size !== decisions.length || decisions.filter(d => d.status === 'pass' && d.call > c.target.event).length < c.target.blocks.length) throw Error('Candidate tool target lacks distinct passing decisions')
  }
  const names = new Set(c.request.tools?.map(tool => tool.name))
  if (names.size !== (c.request.tools?.length ?? 0)) throw Error('Duplicate candidate tool definition')
  validateMessages(c.request.messages as unknown as Message[], names)
  if (c.target.policy === 'final-answer') validateMessages([...c.request.messages, c.response] as unknown as Message[], names)
  if (c.sftEligible && (c.grade.required.some(key => c.grade.observations[key].status !== 'pass') || c.sourceEvidence.approvals.length || c.split === null || c.conflictVersions?.length)) throw Error('Candidate eligibility contradicts evidence')
  // Open DSH message extensions remain source evidence; destination converters reject unsupported blocks.
  return c as unknown as Candidate
}

/** Phoenix-owned assignments pinned to an immutable promoted version. */
export interface SplitAssignment { keys: string[]; split: 'train' | 'validation' | 'test'; version: string }

/** Identify connected candidate evidence consistently for partitioning and Phoenix publication.
 * @param candidate - candidate whose eligibility controls duplicate-output grouping.
 * @returns stable family, task, session, request, row and eligible output keys.
 */
export function candidateGroupKeys(candidate: Candidate): string[] {
  const p = candidate.provenance
  return [`family:${p.family}`, `task:${p.task}`, `session:${p.session}`, `session:${p.rootSession}`, ...p.parentSession ? [`session:${p.parentSession}`] : [], `request:${p.requestHash}`, `row:${p.rowHash}`, ...candidate.sftEligible ? [`output:${p.outputHash}`] : []]
}

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
  const keys = candidateGroupKeys
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
