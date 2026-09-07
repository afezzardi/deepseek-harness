/** Recorded-session replay uses upstream validation, surface folding, and stream readers. */
import { BlockAssembler, expandAssistantStream, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, foldRequestHeader, foldSurface, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { Settings } from './config.ts'
import type { TraceMapper } from './mapper.ts'

/** Replay a validated detached session into the shared mapper.
 * @param snapshot - session-query's consistent logical log (may include interruption closers).
 * @param mapper - replay-origin mapper.
 * @param settings - capture and batch bounds.
 * @param flush - awaited transport flush, preventing replay from outrunning the SDK queue.
 * @returns when all mapped spans have been offered to the receiver.
 */
export async function replaySnapshot(snapshot: SessionLogSnapshot, mapper: TraceMapper, settings: Settings, flush: () => Promise<void>): Promise<void> {
  const prefix: SessionEvent[] = []
  let header: ReturnType<typeof foldRequestHeader>
  for (const event of snapshot.events) {
    header = foldRequestHeader([event], header)
    if ((event.type === 'assistant/message' || event.type === 'assistant/attempt') && event.seq >= snapshot.inheritedEventCount) {
      const stream = expandAssistantStream(event.data.stream)
      const first = stream[0]
      if (header && first) {
        const messages = foldSurface(prefix).nodes.flatMap(seq => {
          const source = prefix[seq]
          const message = source ? deriveEventMessage(source) : null
          return message ? [message] : []
        })
        const request: GenerateOptions = { ...header.config, messages, sessionId: snapshot.session.id,
          ...header.system === undefined ? {} : { system: header.system },
          ...header.tools === undefined ? {} : { tools: header.tools },
        }
        const id = `${snapshot.session.id}:${event.seq}`
        mapper.startCall(id, request, first.time, event.seq)
        const assembler = new BlockAssembler()
        let bytes = 0
        let truncated = false
        let finish = 'incomplete'
        let usage
        for (const timed of stream) {
          if (timed.chunk.type === 'usage') usage = timed.chunk.usage
          if (timed.chunk.type === 'finish') finish = timed.chunk.reason.kind
          bytes += Buffer.byteLength(JSON.stringify(timed.chunk))
          if (bytes <= settings.maxStreamBytes) assembler.push(timed.chunk)
          else truncated = true
        }
        mapper.endCall(id, { ended: stream.at(-1)?.time ?? event.time,
          blocks: truncated || finish === 'incomplete' || finish === 'aborted' ? assembler.interruptedBlocks() : assembler.blocks(),
          finish, truncated, ...usage === undefined ? {} : { usage },
        })
      }
    }
    mapper.event(snapshot.session, snapshot.inheritedEventCount, event)
    prefix.push(event)
    if (prefix.length % settings.maxExportBatchSize === 0) await flush()
  }
  mapper.disposeSession(String(snapshot.session.id), snapshot.events.at(-1)?.time ?? snapshot.session.createdAt)
  await flush()
}
