/** Instance-local OTLP pipeline with bounded queues and observable loss. */
import { createHash } from 'node:crypto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ExportResultCode } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { AlwaysOnSampler, BatchSpanProcessor, TracerProvider, type IdGenerator, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace'
import type { Settings } from './config.ts'

/** Process-local counters; exported means the receiver acknowledged the batch. */
export interface Diagnostics {
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
  return { recordsAccepted: 0, recordsDropped: 0, captureErrors: 0, spansAccepted: 0, spansDropped: 0, spansExported: 0, spansFailed: 0, pendingSpans: 0 }
}

/** Synchronous span creation consumes a source key without sharing global context. */
export class SourceIds implements IdGenerator {
  key = ''
  generateTraceId(): string { return createHash('sha256').update(`gh:v1:trace:${this.key}`).digest('hex').slice(0, 32) }
  generateSpanId(): string { return createHash('sha256').update(`gh:v1:span:${this.key}`).digest('hex').slice(0, 16) }
}

/** Bounded queue for immutable captured records; work runs outside the event callback. */
export class CaptureQueue {
  private pending: Array<() => void> = []
  private closed = false
  constructor(private readonly limit: number, private readonly stats: Diagnostics) {}
  /** Enqueue work without waiting for mapping or network I/O.
   * @param work - captured immutable data consumer.
   */
  push(work: () => void): void {
    if (this.closed || this.pending.length >= this.limit) { this.stats.recordsDropped++; return }
    this.stats.recordsAccepted++
    this.pending.push(work)
    if (this.pending.length === 1) queueMicrotask(() => this.drain())
  }
  /** Run queued mapping jobs, containing each observer failure. */
  drain(): void {
    const jobs = this.pending
    this.pending = []
    for (const work of jobs) {
      try { work() } catch { this.stats.captureErrors++ }
    }
  }
  /** Stop admissions and finish already accepted mapping jobs. */
  close(): void { this.closed = true; this.drain() }
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
