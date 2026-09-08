/** Validated local training candidates from upstream logical Session snapshots. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { expandAssistantStream, type ContentBlock, type Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, foldRequestHeader, foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { ContentPolicy } from './content.ts'

const toolCall = z.object({ id: z.string().min(1), type: z.literal('function'), function: z.object({ name: z.string().min(1), arguments: z.string() }).strict() }).strict()
const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string(),
  weight: z.union([z.literal(0), z.literal(1)]).optional(),
  reasoning_content: z.string().optional(), tool_calls: z.array(toolCall).min(1).optional(), tool_call_id: z.string().optional(),
}).strict()
const rowSchema = z.object({ messages: z.array(messageSchema).min(2), tools: z.array(z.object({
  type: z.literal('function'), function: z.object({ name: z.string().min(1), description: z.string(), parameters: z.record(z.string(), z.unknown()) }).strict(),
}).strict()).optional() }).strict()
/** Locally validated subset of Fireworks managed SFT JSONL. Renderer approval is separate. */
export type TrainingRow = z.infer<typeof rowSchema>
/** Independent grader results; every required dimension has an explicit outcome. */
export const gradeSchema = z.object({
  version: z.string().min(1), syntax: z.boolean(), semantics: z.boolean(),
  tools: z.boolean(), environment: z.boolean(),
}).strict()
/** Task grouping is assigned before evaluating or exporting model outputs. */
export const provenanceSchema = z.object({
  family: z.string().min(1), task: z.string().min(1), trial: z.string().min(1),
  rootSession: z.string().min(1), revision: z.string().min(1), configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  privacy: z.enum(['synthetic-reviewed', 'unreviewed']),
}).strict()
/** Candidate metadata required independently of model output. */
export type Provenance = z.infer<typeof provenanceSchema>
/** Orthogonal, versioned task grades. */
export type Grade = z.infer<typeof gradeSchema>

/** Hash JSON with sorted object keys; array order remains significant.
 * @param value - JSON data; unsupported serialization throws.
 * @returns SHA-256 identity of the exact normalized data.
 */
export function digest(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, member: unknown) => member && typeof member === 'object' && !Array.isArray(member)
    ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : member)
  if (encoded === undefined) throw Error('Unserializable hash input')
  return createHash('sha256').update(encoded).digest('hex')
}

/** Validate serialized training data, including role, tool-pairing, and loss-mask rules.
 * @param input - parsed JSONL row.
 * @returns validated final-answer-only row; rejects malformed or unsupported content.
 */
export function validateTrainingRow(input: unknown): TrainingRow {
  const row = rowSchema.parse(input)
  if (!row.messages.some(message => message.role === 'user')) throw Error('Missing user request')
  const pending = new Set<string>()
  const used = new Set<string>()
  const names = new Set(row.tools?.map(tool => tool.function.name))
  if (names.size !== (row.tools?.length ?? 0)) throw Error('Duplicate tool definition')
  for (const [index, message] of row.messages.entries()) {
    const target = index === row.messages.length - 1
    if (message.role === 'system' && index !== 0) throw Error('System message must be first')
    if (message.role !== 'assistant' && (message.weight !== undefined || message.reasoning_content !== undefined || message.tool_calls !== undefined)) throw Error('Assistant fields on non-assistant message')
    if (message.role !== 'tool' && message.tool_call_id !== undefined) throw Error('Tool result ID on non-tool message')
    if (message.role === 'assistant' && message.weight !== Number(target)) throw Error('Only final assistant may have positive loss')
    if (pending.size && message.role !== 'tool') throw Error('Missing tool results')
    for (const call of message.tool_calls ?? []) {
      if (!names.has(call.function.name) || used.has(call.id)) throw Error('Unknown tool or duplicate call ID')
      const args: unknown = JSON.parse(call.function.arguments)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Tool arguments must be a JSON object')
      used.add(call.id)
      pending.add(call.id)
    }
    if (message.role === 'tool' && (!message.tool_call_id || !pending.delete(message.tool_call_id))) throw Error('Unpaired tool result')
    if (target && (message.role !== 'assistant' || !message.content.trim() || message.tool_calls)) throw Error('Expected a nonempty final assistant answer')
  }
  if (pending.size) throw Error('Unsettled tools')
  return row
}

function convertMessage(message: Message, target = false): TrainingRow['messages'][number] {
  const role = message.source.kind === 'tool' ? 'tool' : message.role
  const row: TrainingRow['messages'][number] = { role, content: '', ...role === 'assistant' ? { weight: target ? 1 : 0 } : {} }
  for (const block of message.content) {
    switch (block.type) {
      case 'text': row.content += block.text; break
      case 'reasoning':
        // Final reasoning is preserved in source evidence but has no independent grade.
        if (!target) row.reasoning_content = (row.reasoning_content ?? '') + block.text
        break
      case 'tool-call':
        (row.tool_calls ??= []).push({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } })
        break
      case 'tool-result':
        if (message.content.length !== 1 || role !== 'tool') throw Error('Unsupported tool-result arrangement')
        row.tool_call_id = block.toolCallId
        row.content = textOnly(block.content)
        break
      default: throw Error(`Unsupported message block: ${block.type}`)
    }
  }
  return row
}

function textOnly(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type !== 'text') throw Error('Unsupported tool-result content')
    return block.text
  }).join('')
}

/** Export one complete final call from a validated canonical session.
 * Capture rejection is independent of the grade; failing answers can support preferences.
 * @param snapshot - detached snapshot read through upstream session-query.
 * @param provenance - independently assigned task and source metadata.
 * @param grade - independent outcome assessment.
 * @param policy - explicit content/privacy export policy.
 * @returns candidate with provenance; throws on incomplete or unsupported evidence.
 */
export function curateSession(snapshot: SessionLogSnapshot, provenance: Provenance, grade: Grade, policy: ContentPolicy) {
  provenanceSchema.parse(provenance)
  gradeSchema.parse(grade)
  const target = snapshot.events.findLast(event => event.type === 'assistant/message')
  const terminal = snapshot.events.findLast(event => event.type === 'turn/end')
  if (!target || target.type !== 'assistant/message' || target.seq < snapshot.inheritedEventCount) throw Error('Missing owned final answer')
  if (!terminal || terminal.type !== 'turn/end' || terminal.seq < target.seq || terminal.data.turn !== target.data.turn || terminal.data.reason.kind !== 'completed') throw Error('Incomplete or failed turn')
  const finish = expandAssistantStream(target.data.stream).findLast(chunk => chunk.chunk.type === 'finish')?.chunk
  if (finish?.type !== 'finish' || finish.reason.kind !== 'stop') throw Error('Truncated or incomplete target')
  const prefix = snapshot.events.slice(0, target.seq)
  const header = foldRequestHeader(prefix)
  if (!header) throw Error('Missing request header')
  const messages = foldSurface(prefix).nodes.flatMap(seq => {
    const event = prefix[seq]
    const message = event ? deriveEventMessage(event) : null
    return message ? [message] : []
  })
  const input = [
    ...header.system === undefined ? [] : [{ role: 'system' as const, content: header.system }],
    ...messages.map(message => convertMessage(message)),
  ]
  const tools = header.tools?.map(tool => ({ type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
  const row = validateTrainingRow({ messages: [...input, convertMessage(target.data.message, true)], ...tools === undefined ? {} : { tools } })
  const capture = policy.attributes('candidate', { row, config: header.config })
  if (capture['gh.content.candidate.status'] !== 'complete') throw Error(`Capture ${String(capture['gh.content.candidate.status'])}`)
  if (provenance.privacy !== 'synthetic-reviewed') throw Error('Privacy review missing')
  const frozenRequest = { messages: input, ...tools === undefined ? {} : { tools }, config: header.config }
  return {
    version: 1 as const, row, grade, provenance: { ...provenance,
      session: String(snapshot.session.id), parentSession: snapshot.session.parentSession ?? null,
      sessionVersion: snapshot.session.version, sourceEvent: target.seq, sourceHash: digest(snapshot),
      requestHash: digest(frozenRequest), toolsHash: digest(tools ?? null), configHash: digest(header.config),
      requestedReasoningEffort: header.config.reasoningEffort ?? null,
      rowHash: digest(row), representation: 'reconstructed-harness', targetPolicy: 'final-answer-only; target-reasoning-omitted',
      renderer: 'unverified', tokenizer: 'unobserved', checkpoint: 'unobserved',
    }, frozenRequest,
    sftEligible: Object.entries(grade).every(([key, value]) => key === 'version' || value === true),
    trainingReady: false as const,
  }
}
/** Validated local candidate, deliberately distinct from renderer-approved training input. */
export type Candidate = ReturnType<typeof curateSession>

/** Assign connected task/session groups to a single split, then deduplicate outputs.
 * Held-out membership takes priority over validation and training for an entire group.
 * @param candidates - validated candidates, including failures for audit.
 * @param heldOut - families reserved before experimentation.
 * @param validation - families reserved for development evaluation.
 * @returns annotated rows and duplicate source references.
 */
export function partitionCandidates(candidates: readonly Candidate[], heldOut: readonly string[], validation: readonly string[]) {
  const parents = new Map<string, string>()
  const find = (key: string): string => {
    const parent = parents.get(key)
    if (!parent) { parents.set(key, key); return key }
    if (parent === key) return key
    const root = find(parent)
    parents.set(key, root)
    return root
  }
  const union = (a: string, b: string): void => { parents.set(find(a), find(b)) }
  for (const candidate of candidates) {
    const p = candidate.provenance
    union(`family:${p.family}`, `session:${p.rootSession}`)
    union(`session:${p.session}`, `session:${p.rootSession}`)
    if (p.parentSession) union(`session:${p.session}`, `session:${p.parentSession}`)
    union(`family:${p.family}`, `request:${p.requestHash}`)
    union(`family:${p.family}`, `row:${p.rowHash}`)
  }
  const ranks = new Map<string, number>()
  for (const c of candidates) {
    const key = find(`family:${c.provenance.family}`)
    const rank = heldOut.includes(c.provenance.family) ? 2 : validation.includes(c.provenance.family) ? 1 : 0
    ranks.set(key, Math.max(ranks.get(key) ?? 0, rank))
  }
  const seen = new Map<string, string>()
  return candidates.map(candidate => {
    const split = (['train', 'validation', 'test'] as const)[ranks.get(find(`family:${candidate.provenance.family}`)) ?? 0]!
    const duplicateOf = seen.get(candidate.provenance.rowHash) ?? null
    seen.set(candidate.provenance.rowHash, candidate.provenance.trial)
    return { ...candidate, split, duplicateOf }
  })
}

/** Construct a conservative managed-DPO pair from an identical frozen request.
 * @param chosen - independently passing answer.
 * @param rejected - independently failing answer with complete capture.
 * @returns one-turn, text-only Fireworks preference row; rejects tools and ties.
 */
export function preferencePair(chosen: Candidate, rejected: Candidate) {
  if (chosen.provenance.requestHash !== rejected.provenance.requestHash || digest(chosen.frozenRequest) !== digest(rejected.frozenRequest) || digest(chosen.frozenRequest) !== chosen.provenance.requestHash) throw Error('Preference requests differ')
  if (!chosen.sftEligible || rejected.sftEligible || chosen.grade.version !== rejected.grade.version) throw Error('No independently graded preference')
  const input = chosen.row.messages.slice(0, -1)
  if (chosen.row.tools?.length || rejected.row.tools?.length || input.filter(message => message.role === 'user').length !== 1 || input.some(message => !['system', 'user'].includes(message.role))) throw Error('Managed DPO requires one-turn text without tools')
  const output = (candidate: Candidate) => ({ role: 'assistant' as const, content: candidate.row.messages.at(-1)!.content })
  if (output(chosen).content === output(rejected).content) throw Error('Identical preference outputs')
  return { input: { messages: input }, preferred_output: [output(chosen)], non_preferred_output: [output(rejected)] }
}
