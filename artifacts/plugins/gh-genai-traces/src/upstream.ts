/** DSH V3 observations shared by replay, grading, and dataset consumers. */
import type { Context } from '@deepseek-ai/cordis'
import { Session, interruptedTurnClosers, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'

/** Pinned source used to qualify this adapter. */
export const UPSTREAM_REVISION = 'c291e7961a515f6d7af9304e7fd1d257929aef26'

/** Source observation and exact in-memory repair range. */
export interface ArtifactSnapshot extends SessionLogSnapshot {
  reconstruction: { version: 1; source: 'live' | 'persistence'; storedEventCount: number | null; repairEventSeqs: number[] }
}

/** Read without activating a Session. Upstream may publish a migrated successor.
 * @param ctx - profile-owned live sessions and persistence services.
 * @param id - canonical session identity.
 * @returns validated detached current-format history and repair provenance.
 */
export async function readArtifactSnapshot(ctx: Context, id: SessionId): Promise<ArtifactSnapshot> {
  const live = ctx.sessions.get(id)
  let header, inheritedEventCount, events
  const source = live ? 'live' : 'persistence'
  if (live) {
    const observation = await ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })
    try {
      header = structuredClone(observation.header)
      inheritedEventCount = observation.inheritedEventCount
      events = structuredClone([...observation.events])
    } finally { observation[Symbol.dispose]() }
  } else {
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try {
      const read = await handle.read(0)
      header = structuredClone(handle.header)
      inheritedEventCount = handle.inheritedEventCount
      events = structuredClone([...read.events])
    } finally { await handle.close() }
  }
  const storedEventCount = source === 'persistence' ? events.length : null
  const repairs = source === 'persistence' ? interruptedTurnClosers(events) : []
  events.push(...repairs)
  Session.fromRestore(id, events, header, inheritedEventCount, 'detached')
  return { session: header, inheritedEventCount, events,
    reconstruction: { version: 1, source, storedEventCount, repairEventSeqs: repairs.map(event => event.seq) } }
}
