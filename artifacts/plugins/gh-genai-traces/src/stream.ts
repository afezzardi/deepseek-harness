/** Observe lazy streams without changing their chunks, exceptions, or cancellation. */
import { BlockAssembler, type ContentBlock, type GenerateOptions, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Settings } from './config.ts'

/** Captured settlement of one public llm.stream invocation. */
export interface CallResult {
  ended: number
  firstChunk?: number
  firstContent?: number
  blocks: ContentBlock[]
  usage?: TokenUsage
  finish: string
  truncated: boolean
  errorType?: string
}
/** The request fields retained by instrumentation, excluding AbortSignal. */
export type CallRequest = Omit<GenerateOptions, 'signal'>
/** Observe a stream; all observer failures stay outside the consumer's control flow.
 * @param options - original immutable harness request.
 * @param next - downstream waterfall; called once when the wrapper is obtained.
 * @param settings - capture buffer bound.
 * @param start - receives request and wall-clock start when iteration begins.
 * @param end - receives the settlement once, including early iterator return.
 * @param failed - counts an observer defect without throwing.
 * @param now - testable epoch-millisecond clock.
 * @returns a lazy stream preserving downstream values and close behavior.
 */
export function observeStream(
  options: GenerateOptions, next: () => AsyncIterable<StreamChunk>, settings: Settings,
  start: (request: CallRequest, time: number) => void, end: (result: CallResult) => void,
  failed: () => void, now: () => number = Date.now,
): AsyncIterable<StreamChunk> {
  const downstream = next()
  return (async function* () {
    const assembler = new BlockAssembler()
    let bytes = 0
    let truncated = false
    let firstChunk: number | undefined
    let firstContent: number | undefined
    let usage: TokenUsage | undefined
    let finish = 'incomplete'
    let errorType: string | undefined
    const observe = (action: () => void) => { try { action() } catch { failed() } }
    observe(() => {
      const { signal: _signal, ...request } = options
      start(structuredClone(request), now())
    })
    try {
      for await (const chunk of downstream) {
        observe(() => {
          const time = now()
          firstChunk ??= time
          if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && chunk.text.length > 0
            || chunk.type === 'tool-call-delta' && chunk.argumentsDelta.length > 0) firstContent ??= time
          if (chunk.type === 'usage') usage = chunk.usage
          if (chunk.type === 'finish') {
            finish = chunk.reason.kind
            if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') errorType = chunk.reason.failure.code
          }
          if (!truncated) {
            bytes += Buffer.byteLength(JSON.stringify(chunk))
            if (bytes > settings.maxStreamBytes) truncated = true
            else assembler.push(chunk)
          }
        })
        yield chunk
      }
    } catch (error) {
      finish = 'error'
      errorType = error instanceof Error ? error.name : 'UnknownError'
      throw error
    } finally {
      observe(() => end({
        ended: now(), blocks: finish === 'incomplete' || finish === 'aborted' || truncated ? assembler.interruptedBlocks() : assembler.blocks(),
        finish, truncated,
        ...firstChunk === undefined ? {} : { firstChunk },
        ...firstContent === undefined ? {} : { firstContent },
        ...usage === undefined ? {} : { usage },
        ...errorType === undefined ? {} : { errorType },
      }))
    }
  })()
}
