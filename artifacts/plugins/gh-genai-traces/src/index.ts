/** Gruppo Happy's opt-in GenAI telemetry backend for upstream DSH profiles. */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionTelemetryBackend, SessionTelemetryCoordinator, type SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import type {} from '@deepseek-ai/dsh-llm'
import { FeedbackPublisher } from './feedback.ts'
import type {} from '@deepseek-ai/dsh-message-feedback'
import { CallCorrelation } from './correlation.ts'
import type {} from '@deepseek-ai/dsh-agent'
import { ContentPolicy } from './content.ts'
import { resolveConfig, type Config as InputConfig, type Settings } from './config.ts'
import { TraceMapper, callIdentity } from './mapper.ts'
import { readArtifactSnapshot, type ArtifactSnapshot } from './upstream.ts'
import { replaySnapshot } from './replay.ts'
import { observeStream } from './stream.ts'
import { CaptureWorkQueue, SourceIds, createProvider, deadline, diagnostics } from './transport.ts'

/** Deployment inputs, validated strictly by resolveConfig before effects mount. */
export type Config = InputConfig
/** Preserve fields for Zod's strict semantic validation in the constructor. */
export const Config: z<Config> = z.any()

/** Single sessionTelemetry provider; live tracing and explicit historical replay. */
export class GenAITraces extends SessionTelemetryBackend {
  static inject = ['sessions', 'llm', 'sessionQuery', 'sessionPersistence']
  static Config = Config
  readonly sharing = 'full' as const
  readonly diagnostics = diagnostics()
  private readonly settings: Settings
  private readonly queue: CaptureWorkQueue
  private readonly correlation: CallCorrelation
  private readonly feedback: FeedbackPublisher | undefined
  private readonly ownershipAttempts = new Map<string, number>()
  private readonly recovered = new Map<string, ArtifactSnapshot>()
  private readonly envelopes = new Map<string, { header: SessionHeader; inherited: number; event: Omit<SessionEvent, 'data'> }>()
  private readonly mapper: TraceMapper
  private readonly provider: ReturnType<typeof createProvider>
  private readonly policy: ContentPolicy
  private closing: Promise<void> | undefined
  private replayWork: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    const settings = resolveConfig(config)
    super(ctx)
    this.settings = settings
    this.policy = new ContentPolicy(settings, process.env)
    const ids = new SourceIds()
    this.provider = createProvider(settings, this.diagnostics, ids)
    this.mapper = new TraceMapper(this.provider.getTracer('@deepseek-ai/dsh-gh-genai-traces', '0.1.0'), ids, settings, this.policy, this.diagnostics, 'live')
    this.queue = new CaptureWorkQueue(settings.maxPendingRecords, this.diagnostics)
    this.correlation = new CallCorrelation(this.mapper, this.diagnostics, settings.maxPendingRecords)
    this.feedback = settings.feedback.enabled ? new FeedbackPublisher(settings, this.policy, this.diagnostics, {
      list: async () => (await this.ctx.sessionPersistence.list()).map(entry => String(entry.header.id)),
      revision: async id => (await this.ctx.sessionPersistence.stat(SessionId(id)))?.revision,
      read: async id => {
        const handle = await this.ctx.sessionPersistence.open(SessionId(id), 'read')
        try { return { session: structuredClone(handle.header), inheritedEventCount: handle.inheritedEventCount, events: structuredClone([...(await handle.read(0)).events]) } }
        finally { await handle.close() }
      },
      replay: id => this.replay(id),
      flush: () => this.provider.forceFlush(),
      redact: (snapshot, event) => {
        const record: SessionTelemetryRecord = { channel: 'ledger', time: event.time, severity: 'info',
          attributes: { 'session.id': snapshot.session.id, 'event.seq': event.seq, 'event.type': event.type }, body: event.data }
        const filtered = this.ctx.waterfall('session-telemetry/record', record, () => record)
        return { ...event, data: filtered.body } as typeof event
      },
    }) : undefined
    ctx.on('feedback/committed', () => { this.feedback?.request() })
    ctx.on('session/flush', () => { this.feedback?.request() })
    // Capture envelope references before the coordinator synchronously redacts and delivers each live record.
    ctx.on('session/event', (session, event) => {
      const { data: _data, ...envelope } = event
      const key = `${session.id}:${event.seq}`
      if (this.envelopes.size >= settings.maxPendingRecords) this.envelopes.delete(this.envelopes.keys().next().value!)
      this.envelopes.set(key, { header: session.header, inherited: session.inheritedEventCount, event: structuredClone(envelope) })
    })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type !== 'chunk') this.queue.push(() => this.correlation.frame(String(agent.session.id), agent, frame))
    })
    new SessionTelemetryCoordinator(ctx, this, { capture: 'live', includeHistory: false })
    ctx.on('llm/stream', (options, next) => {
      const id = callIdentity()
      return observeStream(options, next, settings,
        (request, time) => {
          const header = request.sessionId ? this.ctx.sessions.get(request.sessionId)?.header : undefined
          this.queue.push(() => this.correlation.start(id, request, time, header))
        },
        result => this.queue.push(() => this.correlation.end(id, result)),
        () => { this.diagnostics.captureErrors++ },
      )
    })
  }

  /** Replay configured sessions after injected services are available. */
  async [Service.init](): Promise<void> {
    for (const id of this.settings.replaySessionIds) await this.replay(id)
    this.feedback?.start()
  }

  /** Nonblocking admission of the coordinator's already-detached payload.
   * @param record - telemetry record; canonical envelope metadata is added without replacing its redacted body.
   */
  emit(record: SessionTelemetryRecord): void {
    const id = String(record.attributes['session.id'])
    if (record.channel === 'ops') {
      if (record.attributes['telemetry.op'] === 'agent-error') this.queue.push(() => this.mapper.operationalError(id, record.time, record.body))
      if (record.attributes['telemetry.op'] === 'shutdown') this.queue.push(() => { this.correlation.flush(id); this.mapper.disposeSession(id, record.time); this.recovered.delete(id); this.ownershipAttempts.delete(id) })
      return
    }
    const seq = record.attributes['event.seq']
    const key = `${id}:${seq}`
    const source = this.envelopes.get(key)
    this.envelopes.delete(key)
    this.queue.push(async () => {
      const recovered = source ?? await this.recoverEnvelope(id, seq)
      if (this.queue.abandoned) return
      if (!recovered || recovered.event.type !== record.attributes['event.type']) throw Error('Telemetry event identity mismatch')
      // Only envelope metadata is recovered; policy-filtered data remains authoritative for export.
      const event = { ...recovered.event, data: record.body } as SessionEvent
      if (this.queue.abandoned) return
      if (recovered.header.parentSession && !this.mapper.hasOwnership(id) && (!this.ownershipAttempts.has(id) || event.type === 'turn/start')) {
        if (this.ownershipAttempts.size >= this.settings.maxActiveSpans) this.ownershipAttempts.delete(this.ownershipAttempts.keys().next().value!)
        this.ownershipAttempts.set(id, event.seq)
        try { await this.recoverOwnership(recovered.header.parentSession) }
        catch { this.diagnostics.ownershipRecoveryFailures++ }
      }
      if (this.queue.abandoned) return
      this.correlation.event(id, event)
      if (event.type === 'turn/end') this.correlation.flush(id)
      this.mapper.event(recovered.header, recovered.inherited, event)
    })
  }

  private async recoverEnvelope(id: string, seq: unknown) {
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) throw Error('Telemetry sequence missing')
    let snapshot = this.recovered.get(id)
    if (!snapshot || snapshot.events.length <= seq) {
      snapshot = await readArtifactSnapshot(this.ctx, SessionId(id))
      if (this.queue.abandoned) return
      if (this.recovered.size >= this.settings.maxActiveSpans) this.recovered.delete(this.recovered.keys().next().value!)
      this.recovered.set(id, snapshot)
    }
    const event = snapshot.events[seq]
    if (!event) throw Error('Telemetry source event missing')
    const { data: _data, ...envelope } = event
    return { header: snapshot.session, inherited: snapshot.inheritedEventCount, event: envelope }
  }

  private async recoverOwnership(parentId: SessionId, seen = new Set<string>()): Promise<void> {
    if (seen.has(parentId)) throw Error('Session ancestry cycle')
    seen.add(parentId)
    const parent = await readArtifactSnapshot(this.ctx, parentId)
    if (this.queue.abandoned) return
    if (parent.session.parentSession) await this.recoverOwnership(parent.session.parentSession, seen)
    const events: SessionEvent[] = []
    for (const event of parent.events) {
      if (event.seq < this.mapper.ownershipOffset(parentId)) continue
      if (!['turn/start', 'turn/end', 'tool-workflow/run-start', 'tool-workflow/agent-start'].includes(event.type)) continue
      const record: SessionTelemetryRecord = { channel: 'ledger', time: event.time, severity: 'info',
        attributes: { 'session.id': parentId, 'event.seq': event.seq, 'event.type': event.type }, body: structuredClone(event.data) }
      const filtered = this.ctx.waterfall('session-telemetry/record', record, () => record)
      events.push({ ...event, data: filtered.body } as SessionEvent)
    }
    if (!this.queue.abandoned) this.mapper.indexOwnership(parent.session, events)
  }

  /** Replay one validated session into a separate Phoenix project; reads never activate it.
   * @param sessionId - durable session identity from the configured DSH store.
   * @returns completion after exporter acknowledgement, or rejects on read/export failure.
   */
  replay(sessionId: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('gh-genai-traces is shutting down'))
    const work = this.replayWork.then(async () => {
      const snapshot = await readArtifactSnapshot(this.ctx, SessionId(sessionId))
      const ids = new SourceIds()
      const stats = diagnostics()
      const provider = createProvider({ ...this.settings, project: `${this.settings.project}-replay` }, stats, ids)
      const mapper = new TraceMapper(provider.getTracer('@deepseek-ai/dsh-gh-genai-traces', '0.1.0'), ids, { ...this.settings, project: `${this.settings.project}-replay` }, this.policy, stats, 'replay')
      try {
        const ancestors = []
        let parentId = snapshot.session.parentSession
        const seen = new Set<string>([String(snapshot.session.id)])
        while (parentId && !seen.has(String(parentId))) {
          seen.add(String(parentId))
          const parent = await readArtifactSnapshot(this.ctx, parentId)
          ancestors.unshift(parent)
          parentId = parent.session.parentSession
        }
        for (const ancestor of ancestors) mapper.indexOwnership(ancestor.session, ancestor.events)
        const filtered = { ...snapshot, events: snapshot.events.map(event => {
          const record: SessionTelemetryRecord = { channel: 'ledger', time: event.time, severity: 'info',
            attributes: { 'session.id': snapshot.session.id, 'event.seq': event.seq, 'event.type': event.type }, body: structuredClone(event.data) }
          return { ...event, data: this.ctx.waterfall('session-telemetry/record', record, () => record).body } as SessionEvent
        }) }
        await replaySnapshot(filtered, mapper, this.settings, () => provider.forceFlush())
        if (stats.spansFailed || stats.spansDropped || stats.captureErrors || stats.recordsDropped) throw new Error(`gh-genai-traces replay incomplete: ${JSON.stringify(stats)}`)
      } finally {
        mapper.shutdown()
        await deadline(provider.shutdown(), this.settings.shutdownTimeoutMillis)
        this.ctx.logger.info(`gh-genai-traces replay: ${JSON.stringify(stats)}`)
      }
    })
    // Observe failure for serialization while returning the original rejection.
    this.replayWork = work.catch(() => {})
    return work
  }

  /** Drain capture and export once, preserving diagnostics on bounded shutdown.
   * @returns completion of owned shutdown, or rejects when its deadline expires.
   */
  shutdown(): Promise<void> {
    this.closing ??= (async () => {
      const capture = this.queue.close()
      let exportStop: Promise<void> | undefined
      const stopExport = () => exportStop ??= this.provider.shutdown()
      const drain = async () => {
        await Promise.all([this.feedback?.shutdown(), capture])
        if (this.queue.abandoned) return
        this.correlation.flush()
        this.mapper.shutdown()
        await Promise.all([this.replayWork, stopExport()])
      }
      try { await deadline(drain(), this.settings.shutdownTimeoutMillis) }
      finally {
        this.queue.abandon()
        this.envelopes.clear()
        this.recovered.clear()
        this.ownershipAttempts.clear()
        this.correlation.flush()
        this.mapper.shutdown()
        void stopExport().catch(() => { this.diagnostics.spansFailed++ })
        this.ctx.logger.info(`gh-genai-traces: ${JSON.stringify(this.diagnostics)}`)
      }
    })()
    return this.closing
  }
}
export default GenAITraces
