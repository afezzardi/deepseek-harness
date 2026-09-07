/** Opt-in microbenchmark; measures the wrapper only, not network or model latency. */
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { observeStream } from '../src/stream.ts'
import { resolveConfig } from '../src/config.ts'

it.skipIf(!process.env.GH_GENAI_BENCHMARK)('records stream-wrapper CPU cost for 1000 chunks across 25 paired trials', async () => {
  const settings = resolveConfig({ content: 'rich-redacted' })
  const baseline: number[] = []
  const traced: number[] = []
  let failures = 0
  const source = async function* (): AsyncGenerator<StreamChunk> {
    for (let index = 0; index < 1000; index++) yield { type: 'text-delta', index: 0, text: 'abcdefghijklmnop' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const run = async (enabled: boolean): Promise<number> => {
    const start = performance.now()
    const stream = enabled ? observeStream({ provider: 'fixture', model: 'fixture', messages: [] }, source, settings, () => {}, () => {}, () => { failures++ }) : source()
    let count = 0
    for await (const _chunk of stream) count++
    expect(count).toBe(1001)
    return performance.now() - start
  }
  for (let trial = 0; trial < 29; trial++) {
    const ordered = trial % 2 ? [true, false] : [false, true]
    for (const enabled of ordered) {
      const time = await run(enabled)
      if (trial >= 4) (enabled ? traced : baseline).push(time)
    }
  }
  const summarize = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return { median_ms: sorted[12], p95_ms: sorted[23], trials_ms: values }
  }
  expect(failures).toBe(0)
  await writeFile(process.env.GH_GENAI_BENCHMARK!, JSON.stringify({ node: process.version, platform: process.platform, chunks_per_trial: 1001, payload_characters: 16000, measured_trials: 25, warmup_trials: 4, baseline: summarize(baseline), observed: summarize(traced), capture_errors: failures, scope: 'stream wrapper only; excludes event mapping, export, network, and model latency' }, null, 2) + '\n')
})
