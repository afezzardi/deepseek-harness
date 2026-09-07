/** Gruppo Happy's opt-in GenAI telemetry backend for upstream DSH profiles. */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionTelemetryBackend, SessionTelemetryCoordinator, type SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import type {} from '@deepseek-ai/dsh-llm'
import { ContentPolicy } from './content.ts'
import { resolveConfig, type Config as InputConfig, type Settings } from './config.ts'
import { TraceMapper, callIdentity } from './mapper.ts'
import { replaySnapshot } from './replay.ts'
import { observeStream } from './stream.ts'
import { CaptureQueue, SourceIds, createProvider, deadline, diagnostics } from './transport.ts'

/** Deployment inputs, validated strictly by resolveConfig before effects mount. */
export type Config = InputConfig
/** Preserve fields for Zod's strict semantic validation in the constructor. */
export const Config: z<Config> = z.any()

/** Single sessionTelemetry provider; live tracing and explicit historical replay. */
export class GenAITraces extends SessionTelemetryBackend {
  static inject = ['sessions', 'llm', 'sessionQuery']
  static Config = Config
  readonly sharing = 'full' as const
  readonly diagnostics = diagnostics()
  private readonly settings: Settings
  private readonly queue: CaptureQueue
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
    this.queue = new CaptureQueue(settings.maxPendingRecords, this.diagnostics)
    new SessionTelemetryCoordinator(ctx, this, { capture: 'live', includeHistory: false })
    ctx.on('llm/stream', (options, next) => {
      const id = callIdentity()
      return observeStream(options, next, settings,
        (request, time) => this.queue.push(() => this.mapper.startCall(id, request, time)),
        result => this.queue.push(() => this.mapper.endCall(id, result)),
        () => { this.diagnostics.captureErrors++ },
      )
    })

  }

  /** Replay configured sessions after injected services are available. */
  async [Service.init](): Promise<void> {
    for (const id of this.settings.replaySessionIds) await this.replay(id)
  }

  /** Nonblocking admission of the coordinator's already-detached payload.
   * @param record - telemetry record; canonical envelope metadata is added without replacing its redacted body.
   */
  emit(record: SessionTelemetryRecord): void {
    const id = String(record.attributes['session.id'])
    if (record.channel === 'ops') {
      if (record.attributes['telemetry.op'] === 'agent-error') this.queue.push(() => this.mapper.operationalError(id, record.time, record.body))
      if (record.attributes['telemetry.op'] === 'shutdown') this.queue.push(() => this.mapper.disposeSession(id, record.time))
      return
    }
    const session = this.ctx.sessions.get(SessionId(id))
    const seq = record.attributes['event.seq']
    if (!session || typeof seq !== 'number') { this.diagnostics.captureErrors++; return }
    const source = session.eventAt(SessionSeq(seq))
    if (!source || source.type !== record.attributes['event.type']) { this.diagnostics.captureErrors++; return }
    // The coordinator preserves the event discriminant while carrying its
    // detached data. Do not bypass any deployment redaction of that data.
    const event = { ...source, data: record.body } as SessionEvent
    const header = session.header
    const inherited = session.inheritedEventCount
    this.queue.push(() => this.mapper.event(header, inherited, event))
  }

  /** Replay one validated session into a separate Phoenix project; reads never activate it.
   * @param sessionId - durable session identity from the configured DSH store.
   * @returns completion after exporter acknowledgement, or rejects on read/export failure.
   */
  replay(sessionId: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error('gh-genai-traces is shutting down'))
    const work = this.replayWork.then(async () => {
      const snapshot = await this.ctx.sessionQuery.readSession(SessionId(sessionId))
      const ids = new SourceIds()
      const stats = diagnostics()
      const provider = createProvider({ ...this.settings, project: `${this.settings.project}-replay` }, stats, ids)
      const mapper = new TraceMapper(provider.getTracer('@deepseek-ai/dsh-gh-genai-traces', '0.1.0'), ids, this.settings, this.policy, stats, 'replay')
      try {
        await replaySnapshot(snapshot, mapper, this.settings, () => provider.forceFlush())
        if (stats.spansFailed || stats.spansDropped || stats.captureErrors) throw new Error(`gh-genai-traces replay incomplete: ${JSON.stringify(stats)}`)
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
      this.queue.close()
      this.mapper.shutdown()
      try {
        await deadline(Promise.all([this.replayWork, this.provider.shutdown()]).then(() => {}), this.settings.shutdownTimeoutMillis)
      } finally {
        this.ctx.logger.info(`gh-genai-traces: ${JSON.stringify(this.diagnostics)}`)
      }
    })()
    return this.closing
  }
}
export default GenAITraces
