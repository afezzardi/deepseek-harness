/** Small canonical trajectory: a tool request, observation, and final answer. */
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'

/** Generate a validated tool trajectory with deterministic event timestamps.
 * @param id - test-owned session identity.
 * @returns a detached snapshot admitted by upstream Session validation.
 */
export function fixture(id = 'fixture'): SessionLogSnapshot {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Read fixture.txt then report its value.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' }, system: 'Use the read tool.', tools: [{ name: 'read', description: 'Read one file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }] } })
  const callId = ToolCallId('call-read')
  const block = { type: 'tool-call' as const, id: callId, name: 'read', arguments: '{"path":"fixture.txt"}' }
  const stream: AssistantStreamRecord[] = [
    { type: 'chunk', time: 1040, chunk: { type: 'block-end', index: 0, block } },
    { type: 'chunk', time: 1041, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 0 } } },
    { type: 'chunk', time: 1042, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  ]
  session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [block] }), stream, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 0 } }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: block.arguments })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: '42' }], isError: false }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  const answer = { type: 'text' as const, text: 'The value is 42.' }
  session.append('assistant/message', { turn: 1, step: 2, message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [answer] }), stream: [
    { type: 'chunk', time: 1090, chunk: { type: 'block-end', index: 0, block: answer } },
    { type: 'chunk', time: 1091, chunk: { type: 'usage', usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 2, cacheWriteTokens: 0 } } },
    { type: 'chunk', time: 1092, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ], usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 2, cacheWriteTokens: 0 } }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const events: SessionEvent[] = session.snapshotEvents().map((event, index) => ({ ...event, time: 1000 + index * 10 }))
  const header = { ...session.header, createdAt: 1000 }
  Session.create(header.id, events, header)
  return { session: header, inheritedEventCount: SessionLogOffset(0), events }
}
