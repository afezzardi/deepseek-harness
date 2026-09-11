import { describe, expect, it } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
import type { SpanExporter } from '@opentelemetry/sdk-trace'
import { CaptureWorkQueue, createProvider, diagnostics, SourceIds } from '../src/transport.ts'
import { resolveConfig } from '../src/config.ts'

describe('bounded capture and delivery', () => {
  it('reports queue overflow and contains mapping failures', async () => {
    const stats = diagnostics()
    const queue = new CaptureWorkQueue(2, stats)
    const ran: number[] = []
    queue.push(() => { throw Error('mapping') })
    queue.push(() => { ran.push(1) })
    queue.push(() => { ran.push(2) })
    await queue.close()
    expect(ran).toEqual([1])
    expect(stats).toMatchObject({ recordsAccepted: 2, recordsDropped: 1, captureErrors: 1 })
    queue.push(() => { ran.push(3) })
    expect(stats.recordsDropped).toBe(2)
  })
  it('reports exporter failures and bounds accepted pending spans', async () => {
    const stats = diagnostics()
    const exporter: SpanExporter = { export(_spans, callback) { callback({ code: ExportResultCode.FAILED }) }, shutdown: async () => {} }
    const ids = new SourceIds()
    const provider = createProvider(resolveConfig({ maxQueueSize: 2, maxExportBatchSize: 2 }), stats, ids, exporter)
    try {
      for (let i = 0; i < 6; i++) { ids.key = String(i); provider.getTracer('test').startSpan('test').end() }
      await expect(provider.forceFlush()).rejects.toEqual([expect.any(Error)])
      expect(stats.spansAccepted + stats.spansDropped).toBe(6)
      expect(stats.spansFailed).toBe(stats.spansAccepted)
      expect(stats.pendingSpans).toBe(0)
    } finally { await provider.shutdown() }
  })
})
