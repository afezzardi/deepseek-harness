/** Detached canonical reads; storage decoding and interruption repair remain upstream-owned. */
import type { Context } from '@deepseek-ai/cordis'
import { Session, interruptedTurnClosers, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'

/** Source observation and exact in-memory repair range. */
export interface ArtifactSnapshot extends SessionLogSnapshot {
  reconstruction: { version: 1; source: 'live' | 'persistence'; storedEventCount: number; repairEventSeqs: number[] }
}

/** Read without activating a stored session or changing a released generation.
 * @param ctx - profile-owned live sessions and persistence services.
 * @param id - canonical session identity.
 * @returns validated detached history with original sequence identities.
 */
export async function readArtifactSnapshot(ctx: Context, id: SessionId): Promise<ArtifactSnapshot> {
  const live = ctx.sessions.get(id)
  let header, inheritedEventCount, events
  const source = live ? 'live' : 'persistence'
  if (live) {
    header = structuredClone(live.header)
    inheritedEventCount = live.inheritedEventCount
    events = structuredClone([...live.snapshotEvents()])
  } else {
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try {
      const read = await handle.read(0)
      header = structuredClone(handle.header)
      inheritedEventCount = handle.inheritedEventCount
      events = structuredClone([...read.events])
    } finally { await handle.close() }
  }
  const storedEventCount = events.length
  const repairs = source === 'persistence' ? interruptedTurnClosers(events) : []
  events.push(...repairs)
  Session.fromRestore(id, events, header, inheritedEventCount, 'detached')
  return { session: header, inheritedEventCount, events,
    reconstruction: { version: 1, source, storedEventCount, repairEventSeqs: repairs.map(event => event.seq) } }
}
