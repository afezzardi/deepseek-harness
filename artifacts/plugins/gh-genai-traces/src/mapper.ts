/** Correlate DSH events and public model calls into source-addressable spans. */
import { randomUUID } from 'node:crypto'
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Attributes, type Span, type Tracer, type SpanContext } from '@opentelemetry/api'
import { type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/src/turn-usage.ts'
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import { digest } from './curation.ts'
import { ContentPolicy, inputMessages, parts, usageAttributes } from './content.ts'
import type { Settings } from './config.ts'
import type { CallRequest, CallResult } from './stream.ts'
import { type Diagnostics, SourceIds } from './transport.ts'

interface OpenSpan { span: Span; time: number; key: string; events: number; dropped: number }
interface Turn {
  number: number
  root: OpenSpan
  step?: OpenSpan
  stepNumber?: number
  calls: number
  tools: Map<string, OpenSpan>
  workflows: Map<string, OpenSpan>
  events: SessionEvent[]
  incomplete: boolean
}
interface SessionState { header: SessionHeader; turn?: Turn; lastSeq: number }
interface ModelCall { capture: Attributes; open: OpenSpan; sessionId?: string; start: number; incomplete: boolean }
/** Live and replay use the same span presentation, with explicit origin labels. */
export type CaptureOrigin = 'live' | 'replay'

/** Stateful presentation only; durable session events remain authoritative. */
export class TraceMapper {
  private readonly sessions = new Map<string, SessionState>()
  private readonly calls = new Map<string, ModelCall>()
  private readonly active = new Set<OpenSpan>()
  private readonly childLinks = new Map<string, OpenSpan>()
  private readonly deferred = new Map<string, Array<() => void>>()
  private readonly deferredCalls = new Map<string, string>()
  private readonly releasing = new Set<string>()
  private deferredCount = 0
  private readonly ownership = new Map<string, { parentKey: string; traceKey: string }>()
  constructor(
    private readonly tracer: Tracer, private readonly ids: SourceIds,
    private readonly settings: Settings, private readonly policy: ContentPolicy,
    private readonly stats: Diagnostics, private readonly origin: CaptureOrigin,
  ) {}

  private open(key: string, name: string, time: number, attributes: Attributes, parent?: OpenSpan | SpanContext, kind = SpanKind.INTERNAL): OpenSpan | undefined {
    if (this.active.size >= this.settings.maxActiveSpans) { this.stats.spansDropped++; return undefined }
    this.ids.key = `${this.origin}:${key}`
    const span = this.tracer.startSpan(this.policy.text(name), { kind, startTime: time, attributes: {
      ...attributes, 'gh.source.id': key, 'gh.capture.origin': this.origin,
      'gh.mapping.version': '2', 'gh.capture.content': this.settings.content,
      'metadata': JSON.stringify(this.settings.metadata),
    } }, parent ? 'span' in parent ? trace.setSpan(ROOT_CONTEXT, parent.span) : trace.setSpanContext(ROOT_CONTEXT, parent) : ROOT_CONTEXT)
    const open = { span, time, key, events: 0, dropped: 0 }
    this.active.add(open)
    return open
  }
  /** Index recorded workflow membership before mapping a child, including cold replay.
   * Ancestors must be indexed before descendants; sequence establishes the owning turn.
   * @param header - parent session identity.
   * @param events - canonical parent records obtained from upstream services.
   */
  indexOwnership(header: SessionHeader, events: readonly SessionEvent[]): void {
    let turn: number | undefined
    const runs = new Map<string, string>()
    for (const event of events) {
      if (event.type === 'turn/start') turn = event.data.turn
      if (event.type === 'turn/end') turn = undefined
      if (event.type === 'tool-workflow/run-start' && turn !== undefined) {
        runs.set(event.data.runId, this.ownership.get(String(header.id))?.traceKey ?? `${header.id}/turn/${turn}`)
      }
      if (event.type === 'tool-workflow/agent-start') {
        const traceKey = runs.get(event.data.runId)
        if (traceKey && this.ownership.size < this.settings.maxActiveSpans) {
          this.ownership.set(event.data.childId, { parentKey: `${header.id}/workflow/${event.data.runId}`, traceKey })
          this.releaseDeferred(event.data.childId)
        }
      }
    }
  }

  private defer(id: string, work: () => void): boolean {
    if (this.deferredCount >= this.settings.maxPendingRecords) { this.stats.recordsDropped++; return false }
    const pending = this.deferred.get(id) ?? []
    pending.push(work)
    this.deferred.set(id, pending)
    this.deferredCount++
    return true
  }

  private releaseDeferred(id: string): void {
    const pending = this.deferred.get(id)
    if (!pending) return
    this.deferred.delete(id)
    this.deferredCount -= pending.length
    this.releasing.add(id)
    try { for (const work of pending) work() } finally { this.releasing.delete(id) }
  }

  private ownedParent(id: string): SpanContext | undefined {
    const owner = this.ownership.get(id)
    if (!owner) return undefined
    this.ids.key = `${this.origin}:${owner.traceKey}`
    const traceId = this.ids.generateTraceId()
    this.ids.key = `${this.origin}:${owner.parentKey}`
    return { traceId, spanId: this.ids.generateSpanId(), traceFlags: 1, isRemote: true }
  }

  private close(open: OpenSpan | undefined, time: number, incomplete = false): void {
    if (!open || !this.active.delete(open)) return
    open.span.setAttributes({ 'gh.events.dropped': open.dropped, 'gh.capture.incomplete': incomplete || open.dropped > 0 })
    open.span.end(Math.max(open.time, time))
  }
  private attach(open: OpenSpan | undefined, event: SessionEvent): void {
    if (!open) return
    if (open.events >= this.settings.maxEventsPerSpan) { open.dropped++; return }
    open.events++
    open.span.addEvent(event.type, {
      'gh.event.seq': event.seq,
      ...this.policy.attributes('gh.event.data', event.data),
      ...('surfaceOp' in event ? this.policy.attributes('gh.event.surface_op', event.surfaceOp) : {}),
      ...('sourceEventSeqs' in event ? this.policy.attributes('gh.event.source_seqs', event.sourceEventSeqs) : {}),
    }, event.time)
  }

  /** Map one canonical event; inherited events contribute no child spans or usage.
   * @param header - session identity and parent relationship.
   * @param inherited - exact inherited prefix length.
   * @param event - typed event, optionally redacted by upstream telemetry policy.
   */
  event(header: SessionHeader, inherited: number, event: SessionEvent): void {
    if (event.seq < inherited) return
    const id = String(header.id)
    if (this.origin === 'live' && header.parentSession && !this.ownership.has(id) && !this.releasing.has(id)
      && (event.type === 'turn/start' || this.deferred.has(id))) {
      this.defer(id, () => this.event(header, inherited, event))
      return
    }
    let state = this.sessions.get(id)
    if (!state) {
      if (this.sessions.size >= this.settings.maxActiveSpans) { this.stats.recordsDropped++; return }
      state = { header, lastSeq: event.seq - 1 }
      this.sessions.set(id, state)
    }
    if (event.seq <= state.lastSeq) return
    const gap = event.seq !== state.lastSeq + 1
    state.lastSeq = event.seq
    if (gap && state.turn) state.turn.incomplete = true
    const attrs: Attributes = { 'gen_ai.conversation.id': id, 'gh.session.format_version': header.version, 'gh.event.seq': event.seq }
    if (header.parentSession) attrs['gh.session.parent_id'] = String(header.parentSession)
    if (event.type === 'turn/start') {
      if (state.turn) this.endTurn(state, event.time, 'incomplete')
      const root = this.open(`${id}/turn/${event.data.turn}`, 'invoke_agent dsh', event.time,
        { ...attrs, 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'dsh', 'gh.turn': event.data.turn,
          'gh.ownership.status': this.ownership.has(id) ? 'recorded-workflow' : header.parentSession ? 'unresolved-parent' : 'root' }, this.ownedParent(id))
      if (!root) return
      const delegation = this.childLinks.get(id)
      if (delegation) root.span.addLink({ context: delegation.span.spanContext(), attributes: { 'gh.link.kind': 'workflow-child' } })
      state.turn = { number: event.data.turn, root, calls: 0, tools: new Map(), workflows: new Map(), events: [], incomplete: gap }
    }
    const turn = state.turn
    if (!turn) {
      if (!this.settings.exportStandaloneEvents) return
      const standalone = this.open(`${id}/event/${event.seq}`, `dsh ${event.type}`, event.time, attrs)
      this.attach(standalone, event)
      this.close(standalone, event.time)
      return
    }
    if (turn.events.length < this.settings.maxTurnEvents) turn.events.push(event)
    else turn.incomplete = true
    switch (event.type) {
      case 'step/start': {
        if (turn.step) this.close(turn.step, event.time, true)
        const step = this.open(`${id}/turn/${turn.number}/step/${event.data.step}`, 'dsh step', event.time, { ...attrs, 'gh.step': event.data.step, 'openinference.span.kind': 'CHAIN' }, turn.root)
        if (step) turn.step = step
        turn.stepNumber = event.data.step
        turn.calls = 0
        break
      }
      case 'tool/call': {
        const tool = this.open(`${id}/event/${event.seq}`, `execute_tool ${event.data.name}`, event.time,
          { ...attrs, 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': this.policy.text(event.data.name),
            'gen_ai.tool.call.id': event.data.callId, ...this.policy.attributes('gen_ai.tool.call.arguments', event.data.arguments) }, turn.step ?? turn.root)
        if (tool) turn.tools.set(event.data.callId, tool)
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        const tool = turn.tools.get(block.toolCallId)
        if (tool) {
          tool.span.setAttributes(this.policy.attributes('gen_ai.tool.call.result', block.content))
          this.attach(tool, event)
          if (block.isError) tool.span.setStatus({ code: SpanStatusCode.ERROR })
          this.close(tool, event.time, event.data.error?.code === 'TOOL_OUTCOME_UNKNOWN')
          turn.tools.delete(block.toolCallId)
        } else turn.incomplete = true
        break
      }
      case 'tool-workflow/run-start': {
        const workflow = this.open(`${id}/workflow/${event.data.runId}`, 'invoke_workflow dsh', event.time,
          { ...attrs, 'gen_ai.operation.name': 'invoke_workflow', 'gh.workflow.run_id': event.data.runId, 'openinference.span.kind': 'CHAIN', 'gh.workflow.tool_correlation': 'unavailable-in-canonical-events' }, turn.step ?? turn.root)
        if (workflow) turn.workflows.set(event.data.runId, workflow)
        break
      }
      case 'tool-workflow/agent-start': {
        const workflow = turn.workflows.get(event.data.runId)
        this.indexOwnership(header, turn.events)
        if (workflow) {
          if (this.childLinks.size < this.settings.maxActiveSpans) this.childLinks.set(event.data.childId, workflow)
          const child = this.sessions.get(event.data.childId)?.turn?.root
          child?.span.addLink({ context: workflow.span.spanContext(), attributes: { 'gh.link.kind': 'workflow-child' } })
          workflow.span.addEvent('dsh workflow child', { 'gh.child.session_id': event.data.childId, 'gh.workflow.member': event.data.seq }, event.time)
        }
        break
      }
      case 'tool-workflow/run-end': {
        const workflow = turn.workflows.get(event.data.runId)
        if (workflow) workflow.span.setAttribute('gh.workflow.stop_reason', event.data.stopReason)
        this.close(workflow, event.time)
        turn.workflows.delete(event.data.runId)
        break
      }
      default: break // Merge-extensible events retain their payload and source identity.
    }
    this.attach(turn.step ?? turn.root, event)
    if (event.type === 'step/end') { this.close(turn.step, event.time); delete turn.step; delete turn.stepNumber }
    if (event.type === 'turn/end') this.endTurn(state, event.time, event.data.reason.kind)
  }

  private endTurn(state: SessionState, time: number, reason: string): void {
    const turn = state.turn
    if (!turn) return
    const interrupted = reason === 'interrupted' || reason === 'incomplete'
    turn.root.span.setAttribute('gh.turn.outcome', reason)
    if (reason === 'error') turn.root.span.setStatus({ code: SpanStatusCode.ERROR })
    if (reason === 'interrupted') turn.root.span.setAttribute('gh.recovery.balanced', true)
    if (!turn.incomplete) {
      const usage = deriveTurnTokenUsage(turn.events)
      if (usage) turn.root.span.setAttributes({
        'gh.turn.usage.uncached_input_tokens': usage.uncachedInputTokens,
        'gh.turn.usage.output_tokens': usage.outputTokens,
        'gh.turn.usage.total_tokens': usage.totalTokens,
      })
    }
    for (const tool of turn.tools.values()) this.close(tool, time, true)
    for (const workflow of turn.workflows.values()) this.close(workflow, time, true)
    this.close(turn.step, time, interrupted)
    this.close(turn.root, time, interrupted || turn.incomplete)
    delete state.turn
  }

  /** Open one observed public model call. Each retry dispatch has its own request.
   * @param callId - process-local matching key, never interpreted as provider identity.
   * @param request - frozen harness request, before adapter-specific serialization.
   * @param time - dispatch/iteration time for live capture, first recorded chunk for replay.
   * @param sourceSeq - settlement sequence when replay supplies it.
   */
  startCall(callId: string, request: CallRequest, time: number, sourceSeq?: number): void {
    const id = request.sessionId === undefined ? undefined : String(request.sessionId)
    if (id && this.deferred.has(id)) {
      if (this.defer(id, () => { this.deferredCalls.delete(callId); this.startCall(callId, request, time, sourceSeq) })) this.deferredCalls.set(callId, id)
      return
    }
    const state = id === undefined ? undefined : this.sessions.get(id)
    const turn = state?.turn
    const attempt = turn && !request.purpose ? ++turn.calls : 1
    const key = id && sourceSeq !== undefined ? `${id}/model-event/${sourceSeq}`
      : request.purpose || !turn ? `${id ?? 'unscoped'}/aux/${callId}`
      : `${id}/turn/${turn.number}/step/${turn.stepNumber}/call/${attempt}`
    const config = { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort, temperature: request.temperature, maxTokens: request.maxTokens, stop: request.stop }
    const attrs: Attributes = {
      'gh.request.sha256': digest({ system: request.system, messages: inputMessages(request.messages), tools: request.tools, config }),
      'gh.request.tools_sha256': digest(request.tools ?? null), 'gh.request.config_sha256': digest(config),
      'gh.request.reasoning.observation': request.reasoningEffort === undefined ? 'unobserved' : 'requested',
      'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': this.policy.text(request.provider),
      'gen_ai.request.model': this.policy.text(request.model), 'gen_ai.request.stream': true,
      'gh.request.representation': this.origin === 'live' ? 'harness' : 'reconstructed-harness',
      'gh.call.purpose': request.purpose ?? 'conversation', 'gh.call.attempt': attempt,
      ...this.policy.attributes('gen_ai.input.messages', inputMessages(request.messages)),
      ...this.policy.attributes('gh.request.messages', request.messages),
    }
    if (id) attrs['gen_ai.conversation.id'] = id
    if (sourceSeq !== undefined) attrs['gh.event.seq'] = sourceSeq
    if (request.system !== undefined) Object.assign(attrs, this.policy.attributes('gen_ai.system_instructions', [{ type: 'text', content: request.system }]))
    if (request.tools !== undefined) Object.assign(attrs, this.policy.attributes('gen_ai.tool.definitions', request.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters }))))
    if (request.reasoningEffort !== undefined) attrs['gen_ai.request.reasoning.level'] = request.reasoningEffort
    if (request.temperature !== undefined) attrs['gen_ai.request.temperature'] = request.temperature
    if (request.maxTokens !== undefined) attrs['gen_ai.request.max_tokens'] = request.maxTokens
    if (request.stop !== undefined) Object.assign(attrs, this.policy.attributes('gh.request.stop_sequences', request.stop))
    if (this.origin === 'replay') attrs['gh.timing.start_basis'] = 'first-recorded-chunk'
    const open = this.open(key, `chat ${request.model}`, time, attrs, request.purpose ? turn?.root : turn?.step ?? turn?.root, SpanKind.CLIENT)
    if (open) this.calls.set(callId, { capture: attrs, open, start: time, incomplete: !request.purpose && !turn, ...id ? { sessionId: id } : {} })
  }

  /** Settle one observed call without copying usage onto its parent spans.
   * @param callId - key used at start.
   * @param result - bounded output and actual termination facts.
   */
  endCall(callId: string, result: CallResult): void {
    const deferredSession = this.deferredCalls.get(callId)
    if (deferredSession) { this.defer(deferredSession, () => this.endCall(callId, result)); return }
    const call = this.calls.get(callId)
    if (!call) { this.stats.captureErrors++; return }
    const output = this.policy.attributes('gen_ai.output.messages', [{ role: 'assistant', parts: parts(result.blocks), finish_reason: result.finish }])
    const capture = { ...call.capture, ...output }
    const statuses = Object.entries(capture).filter(([key]) => key.startsWith('gh.content.') && key.endsWith('.status')).map(([, value]) => value)
    const reasons = [...new Set(statuses.filter(value => value !== 'complete').map(String))]
    if (result.truncated) reasons.push('stream-truncated')
    if (call.incomplete || result.finish === 'incomplete') reasons.push('missing-evidence')
    if (result.finish !== 'stop' && result.finish !== 'tool-calls') reasons.push(`model-${result.finish}`)
    if (capture['gh.call.purpose'] !== 'conversation') reasons.push('auxiliary')
    call.open.span.setAttributes({
      ...usageAttributes(result.usage),
      ...output,
      'gh.capture.eligible': reasons.length === 0, 'gh.capture.rejection_reasons': reasons,
      'gh.privacy.disposition': 'credential-filtered-not-pii-reviewed',
      'gh.task.outcome': 'ungraded', 'gh.provenance.renderer': 'unobserved',
      'gh.provenance.tokenizer': 'unobserved', 'gh.provenance.checkpoint': 'unobserved',
      'gen_ai.response.finish_reasons': [result.finish], 'gh.stream.truncated': result.truncated,
    })
    if (this.origin === 'live' && result.firstChunk !== undefined) call.open.span.setAttribute('gen_ai.response.time_to_first_chunk', Math.max(0, result.firstChunk - call.start) / 1000)
    if (this.origin === 'live' && result.firstContent !== undefined) call.open.span.setAttribute('gh.response.time_to_first_content_ms', Math.max(0, result.firstContent - call.start))
    if (result.finish === 'error') {
      call.open.span.setStatus({ code: SpanStatusCode.ERROR })
      call.open.span.setAttribute('error.type', this.policy.text(result.errorType ?? 'LlmFailure'))
    }
    this.close(call.open, result.ended, call.incomplete || result.truncated || result.finish === 'incomplete')
    this.calls.delete(callId)
  }

  /** Attach a non-ledger operational error without inventing a source sequence.
   * @param sessionId - session associated with the signal.
   * @param time - observed timestamp.
   * @param body - detached operational payload.
   */
  operationalError(sessionId: string, time: number, body: unknown): void {
    const root = this.sessions.get(sessionId)?.turn?.root
    if (!root) return
    if (root.events >= this.settings.maxEventsPerSpan) { root.dropped++; return }
    root.events++
    root.span.addEvent('dsh agent/error', this.policy.attributes('gh.ops.data', body), time)
  }

  /** Release a disposed session's active presentation state.
   * @param sessionId - session owned by the disposing scope.
   * @param time - disposal time.
   */
  disposeSession(sessionId: string, time: number): void {
    this.releaseDeferred(sessionId)
    const state = this.sessions.get(sessionId)
    if (state) this.endTurn(state, time, 'incomplete')
    this.sessions.delete(sessionId)
    this.childLinks.delete(sessionId)
  }
  /** Close unresolved spans at shutdown; unknown outcomes remain incomplete. */
  shutdown(): void {
    const time = Date.now()
    for (const id of this.deferred.keys()) this.releaseDeferred(id)
    for (const id of this.sessions.keys()) this.disposeSession(id, time)
    for (const open of this.active) this.close(open, time, true)
    this.calls.clear()
    this.deferredCalls.clear()
    this.childLinks.clear()
    this.ownership.clear()
  }
}

/** Allocate a correlation key for a live request without a durable settlement yet.
 * @returns random process-local call identity.
 */
export function callIdentity(): string { return randomUUID() }
