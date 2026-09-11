/** Instance-local OTLP pipeline with bounded queues and observable loss. */
import { createHash } from 'node:crypto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ExportResultCode } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { AlwaysOnSampler, BatchSpanProcessor, TracerProvider, type IdGenerator, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace'
import type { Settings } from './config.ts'

/** Process-local counters; exported means the receiver acknowledged the batch. */
export interface Diagnostics {
  ownershipRecoveryFailures: number
  captureAbandoned: number
  correlationFailures: number
  feedbackPending: number
  feedbackFailures: number
  recordsAccepted: number
  recordsDropped: number
  captureErrors: number
  spansAccepted: number
  spansDropped: number
  spansExported: number
  spansFailed: number
  pendingSpans: number
}
/** Create independent diagnostic state.
 * @returns zeroed counters.
 */
export function diagnostics(): Diagnostics {
  return { ownershipRecoveryFailures: 0, captureAbandoned: 0, correlationFailures: 0, feedbackPending: 0, feedbackFailures: 0, recordsAccepted: 0, recordsDropped: 0, captureErrors: 0, spansAccepted: 0, spansDropped: 0, spansExported: 0, spansFailed: 0, pendingSpans: 0 }
}

/** Synchronous span creation consumes a source key without sharing global context. */
export class SourceIds implements IdGenerator {
  key = ''
  generateTraceId(): string { return createHash('sha256').update(`gh:v4:trace:${this.key}`).digest('hex').slice(0, 32) }
  generateSpanId(): string { return createHash('sha256').update(`gh:v4:span:${this.key}`).digest('hex').slice(0, 16) }
}

/** Build an isolated always-sampled provider; does not register global OTel state.
 * @param settings - validated queue/export limits.
 * @param stats - caller-owned observable counters.
 * @param ids - source-key ID generator.
 * @param suppliedExporter - test-owned exporter; production uses OTLP protobuf.
 * @returns owned provider to flush and shut down.
 */
export function createProvider(settings: Settings, stats: Diagnostics, ids: SourceIds, suppliedExporter?: SpanExporter): TracerProvider {
  const transport = suppliedExporter ?? new OTLPTraceExporter({ url: settings.endpoint, headers: settings.headers, timeoutMillis: settings.exportTimeoutMillis })
  const exporter: SpanExporter = {
    export(spans, callback) {
      transport.export(spans, result => {
        stats.pendingSpans -= spans.length
        if (result.code === ExportResultCode.SUCCESS) stats.spansExported += spans.length
        else stats.spansFailed += spans.length
        callback(result)
      })
    },
    shutdown: () => transport.shutdown(),
    forceFlush: async () => { await transport.forceFlush?.() },
  }
  const batch = new BatchSpanProcessor({
    exporter,
    maxQueueSize: settings.maxQueueSize,
    maxExportBatchSize: settings.maxExportBatchSize,
    scheduledDelayMillis: settings.scheduledDelayMillis,
    exportTimeoutMillis: settings.exportTimeoutMillis,
  })
  const processor: SpanProcessor = {
    onStart: (span, parent) => batch.onStart(span, parent),
    onEnd(span) {
      // Include in-flight exports in this bound; the SDK's internal queue can
      // therefore never overflow invisibly behind our acceptance counter.
      if (stats.pendingSpans >= settings.maxQueueSize) { stats.spansDropped++; return }
      stats.pendingSpans++
      stats.spansAccepted++
      batch.onEnd(span)
    },
    forceFlush: () => batch.forceFlush(),
    shutdown: () => batch.shutdown(),
  }
  return new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'gh-genai-traces', 'service.version': '0.1.0', 'openinference.project.name': settings.project }),
    idGenerator: ids,
    sampler: new AlwaysOnSampler(),
    spanProcessors: [processor],
    forceFlushTimeoutMillis: settings.shutdownTimeoutMillis,
    spanLimits: { attributeCountLimit: 128, eventCountLimit: settings.maxEventsPerSpan, attributePerEventCountLimit: 16 },
  })
}

/** Await teardown with an explicit bound while observing late rejection.
 * @param promise - owned teardown.
 * @param milliseconds - total allowed wait.
 * @returns completion or a timeout rejection.
 */
export async function deadline(promise: Promise<void>, milliseconds: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('gh-genai-traces shutdown deadline exceeded')), milliseconds) })])
  } finally { clearTimeout(timer) }
}

/** Ordered asynchronous capture; admissions never await source reads or export. */
export class CaptureWorkQueue {
  abandoned = false
  private pending = 0
  private closed = false
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly limit: number, private readonly stats: Diagnostics) {}

  /** Enqueue one owned observation, counting overload without blocking the producer.
   * @param work - observation whose rejection becomes a capture diagnostic.
   */
  push(work: () => void | Promise<void>): void {
    if (this.closed || this.pending >= this.limit) { this.stats.recordsDropped++; return }
    this.pending++
    this.stats.recordsAccepted++
    this.tail = this.tail.then(() => { if (!this.abandoned) return work() }).catch(() => { this.stats.captureErrors++ }).finally(() => { this.pending-- })
  }

  /** Stop new admissions and await every accepted observation.
   * @returns completion after source reads and mapping settle.
   */
  /** Stop queued work and count observations abandoned at the shutdown deadline. */
  abandon(): void {
    if (this.abandoned) return
    this.abandoned = true
    this.closed = true
    this.stats.captureAbandoned += this.pending
  }

  close(): Promise<void> { this.closed = true; return this.tail }
}
