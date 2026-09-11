/** Correlate observed dispatches only through explicit Agent attempt settlements. */
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { CallRequest, CallResult } from './stream.ts'
import type { TraceMapper } from './mapper.ts'
import type { Diagnostics } from './transport.ts'
import { digest } from './curation.ts'

interface Dispatch { id: string; request: CallRequest; time: number; header?: SessionHeader; result?: CallResult }
interface Attempt { owner: object; id: string; calls: Dispatch[]; event?: SessionEvent }

/** Bounded attempt state; no timestamp or response-text search across attempts. */
export class CallCorrelation {
  private readonly attempts = new Map<string, Attempt>()
  private readonly dispatches = new Map<string, Dispatch>()
  constructor(private readonly mapper: Pick<TraceMapper, 'startCall' | 'endCall'>, private readonly stats: Diagnostics, private readonly limit: number) {}

  /** Observe explicit attempt publication.
   * @param sessionId - owning Session.
   * @param owner - Agent instance, distinguishing resume lifecycles.
   * @param frame - upstream start/chunk/settlement publication.
   */
  frame(sessionId: string, owner: object, frame: AssistantStreamFrame): void {
    if (frame.type === 'chunk') return
    if (frame.type === 'start') {
      this.flush(sessionId)
      if (this.attempts.size >= this.limit) { this.stats.correlationFailures++; return }
      this.attempts.set(sessionId, { owner, id: frame.attemptId, calls: [] })
      return
    }
    const attempt = this.attempts.get(sessionId)
    if (!attempt || attempt.owner !== owner || attempt.id !== frame.attemptId) { this.stats.correlationFailures++; return }
    const event = attempt.event
    const committed = frame.outcome.kind === 'committed' && event?.seq === frame.outcome.seq && event.type === frame.outcome.eventType
    const message = committed && event?.type === 'assistant/message' ? event.data.message : undefined
    const matches = message ? attempt.calls.filter(call => call.result && !call.result.truncated
      && ['stop', 'tool-calls', 'max-tokens', 'aborted'].includes(call.result.finish)
      && digest(call.result.blocks) === digest(message.content)) : []
    for (const [index, call] of attempt.calls.entries()) {
      if (!call.result) {
        this.stats.correlationFailures++
        this.dispatches.delete(call.id)
        this.mapper.startCall(call.id, call.request, call.time, undefined, call.header, undefined, call.id)
        this.mapper.endCall(call.id, { ended: call.time, blocks: [], finish: 'incomplete', truncated: false })
        continue
      }
      const messageId = matches.length === 1 && call === matches[0] ? message?.id : undefined
      if (message && messageId === undefined && !['error', 'aborted'].includes(call.result.finish)) this.stats.correlationFailures++
      this.mapper.startCall(call.id, call.request, call.time, committed ? event?.seq : undefined, call.header,
        messageId, messageId === undefined ? `${call.id}/${index}` : undefined)
      this.mapper.endCall(call.id, call.result)
      this.dispatches.delete(call.id)
    }
    this.attempts.delete(sessionId)
  }

  /** Retain only a delivered canonical settlement until its explicit end frame.
   * @param sessionId - owning Session.
   * @param event - detached, policy-filtered current event.
   */
  event(sessionId: string, event: SessionEvent): void {
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return
    const attempt = this.attempts.get(sessionId)
    if (attempt) attempt.event = event
  }

  /** Capture a dispatch at lazy iteration, after its attempt-start frame.
   * @param id - process-local dispatch identity.
   * @param request - detached harness input.
   * @param time - observed start time.
   * @param header - observed Session metadata.
   */
  start(id: string, request: CallRequest, time: number, header?: SessionHeader): void {
    const attempt = request.sessionId && !request.purpose ? this.attempts.get(request.sessionId) : undefined
    if (!attempt) { this.mapper.startCall(id, request, time, undefined, header); return }
    if (this.dispatches.size >= this.limit) { this.stats.correlationFailures++; this.mapper.startCall(id, request, time, undefined, header); return }
    const call = { id, request, time, ...header === undefined ? {} : { header } }
    attempt.calls.push(call)
    this.dispatches.set(id, call)
  }

  /** Retain actual timing until canonical identity arrives.
   * @param id - process-local dispatch identity.
   * @param result - immutable captured terminal observation.
   */
  end(id: string, result: CallResult): void {
    const call = this.dispatches.get(id)
    if (call) call.result = result
    else this.mapper.endCall(id, result)
  }

  /** Release unmatched observations without inventing message identity.
   * @param sessionId - one disposed Session, or all Sessions when omitted.
   */
  flush(sessionId?: string): void {
    for (const [id, attempt] of this.attempts) {
      if (sessionId !== undefined && id !== sessionId) continue
      for (const call of attempt.calls) {
        this.stats.correlationFailures++
        this.mapper.startCall(call.id, call.request, call.time, undefined, call.header)
        this.mapper.endCall(call.id, call.result ?? { ended: call.time, blocks: [], finish: 'incomplete', truncated: false })
        this.dispatches.delete(call.id)
      }
      this.attempts.delete(id)
    }
  }
}
