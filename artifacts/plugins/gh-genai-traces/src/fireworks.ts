/** Fireworks managed serialization; schema admission is distinct from renderer approval. */
import { z } from 'zod'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { digest, validateCandidate, type Candidate } from './curation.ts'

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
/** Validate serialized training data, including role, tool-pairing, and loss-mask rules.
 * @param input - parsed JSONL row.
 * @param targetPolicy - final assistant content to supervise; tool decisions may end with pending calls.
 * @returns validated row; rejects malformed or unsupported content.
 */
export function validateTrainingRow(input: unknown, targetPolicy: 'final-answer' | 'tool-decision' = 'final-answer'): TrainingRow {
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
    if (target && (message.role !== 'assistant' || (targetPolicy === 'final-answer'
      ? !message.content.trim() || message.tool_calls
      : message.content !== '' || !message.tool_calls?.length))) throw Error('Expected the selected final assistant target')
  }
  if (pending.size && targetPolicy !== 'tool-decision') throw Error('Unsettled tools')
  return row
}

export function convertMessage(message: Message, target = false): TrainingRow['messages'][number] {
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

/** Serialize the selected final-answer objective for managed SFT.
 * @param candidate - backend-neutral source and explicit loss selection.
 * @returns schema-validated row; renderer readiness remains independently required.
 */
export function exportFireworksSft(candidate: Candidate): TrainingRow {
  if (candidate.target.policy !== 'final-answer' || candidate.target.reasoning !== 'omit') throw Error('Fireworks exporter cannot express the selected loss mask')
  const selected = candidate.response.content.flatMap((block, index) => block.type === 'text' && block.text.trim() ? [index] : [])
  if (digest(selected) !== digest(candidate.target.blocks)) throw Error('Fireworks exporter cannot express partial target blocks')
  return serializeCandidate(candidate)
}

function serializeCandidate(candidate: Candidate, targetReasoning?: string): TrainingRow {
  const request = candidate.request
  const target = convertMessage(candidate.response, true)
  if (targetReasoning !== undefined) target.reasoning_content = targetReasoning
  return validateTrainingRow({ messages: [
    ...request.messages.map(message => convertMessage(message)), target,
  ], ...request.tools === undefined ? {} : { tools: request.tools.map(tool => ({ type: 'function', function: tool })) } }, candidate.target.policy)
}

/** Derive reasoning-plus-action SFT from a task-passing candidate.
 * Task outcomes and selected tool grades admit demonstrations; reasoning statements have no independent grade.
 * The original candidate's format-only loss selection remains unchanged.
 * @param input - admitted candidate with complete reviewed source reasoning.
 * @returns a derived row supervising selected reasoning and answer or tool calls, with earlier assistants masked.
 */
export function exportFireworksOutcomeSft(input: Candidate): TrainingRow {
  const candidate = validateCandidate(input)
  if (!candidate.sftEligible || !candidate.split) throw Error('Outcome SFT requires an admitted task-passing candidate with a frozen split')
  const blocks = candidate.response.content
  const validAction = blocks.length > 1 && digest(candidate.target.blocks) === digest(blocks.slice(1).map((_, index) => index + 1))
  if (blocks[0]?.type !== 'reasoning' || !blocks[0].text.trim() || !validAction) {
    throw Error('Outcome SFT requires one nonempty reasoning block followed only by selected answer blocks or tool calls')
  }
  return serializeCandidate(candidate, blocks[0].text)
}

/** Serialize an independently graded, identical-request managed-DPO comparison.
 * @param chosen - passing answer.
 * @param rejected - explicitly failing answer, never an unknown grade.
 * @returns one-turn text preference row.
 */
export function preferencePair(chosen: Candidate, rejected: Candidate) {
  if (chosen.provenance.requestHash !== rejected.provenance.requestHash || digest(chosen.request) !== digest(rejected.request) || digest(chosen.request) !== chosen.provenance.requestHash) throw Error('Preference requests differ')
  if (!chosen.sftEligible || !rejected.grade.required.some(key => rejected.grade.observations[key].status === 'fail') || chosen.grade.version !== rejected.grade.version) throw Error('No independently graded preference')
  const a = exportFireworksSft(chosen), b = exportFireworksSft(rejected)
  const input = a.messages.slice(0, -1)
  if (a.tools?.length || b.tools?.length || input.filter(message => message.role === 'user').length !== 1 || input.some(message => !['system', 'user'].includes(message.role))) throw Error('Managed DPO requires one-turn text without tools')
  const output = (row: TrainingRow) => ({ role: 'assistant' as const, content: row.messages.at(-1)!.content })
  if (output(a).content === output(b).content) throw Error('Identical preference outputs')
  return { input: { messages: input }, preferred_output: [output(a)], non_preferred_output: [output(b)] }
}
