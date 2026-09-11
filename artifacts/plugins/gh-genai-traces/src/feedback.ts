/** Reconcile durable DSH ratings into native Phoenix HUMAN annotations. */
import { mkdir, open } from 'node:fs/promises'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-message-feedback'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { Settings } from './config.ts'
import type { ContentPolicy } from './content.ts'
import { digest } from './curation.ts'
import { SourceIds, type Diagnostics } from './transport.ts'

const annotationName = 'dsh.user_rating'
type RatingEvent = SessionEvent<'feedback/message-put' | 'feedback/message-delete'>

/** Source operations remain owned by the Host plugin, never by Phoenix. */
export interface FeedbackSources {
  /** List durable Session ids for restart recovery. */
  list(): Promise<readonly string[]>
  /** Opaque persistence change token, comparable only within this process. */
  revision(id: string): Promise<unknown>
  /** Read durable events, excluding unflushed live appends. */
  read(id: string): Promise<SessionLogSnapshot>
  /** Export missing canonical model spans to the replay project. */
  replay(id: string): Promise<void>
  /** Apply the deployment's telemetry waterfall to an exported event copy. */
  redact(snapshot: SessionLogSnapshot, event: RatingEvent): RatingEvent
  /** Flush live spans before probing their annotation targets. */
  flush(): Promise<void>
}

/** One latest mutation per message rated by this Session; tombstones survive reconciliation.
 * @param snapshot - durable canonical history, including inherited records.
 * @returns current puts and deletes keyed by message id.
 */
export function feedbackMutations(snapshot: SessionLogSnapshot): Map<string, RatingEvent> {
  const result = new Map<string, RatingEvent>()
  for (const event of snapshot.events) {
    if ((event.type === 'feedback/message-put' || event.type === 'feedback/message-delete') && event.data.sessionId === snapshot.session.id) {
      result.set(event.type === 'feedback/message-put' ? event.data.item.messageId : event.data.messageId, event)
    }
  }
  return result
}

/** Exact model span identity shared with live settlement and replay.
 * @param project - Phoenix project.
 * @param origin - observed live dispatch or reconstructed replay.
 * @param session - canonical Session id.
 * @param message - canonical assistant message id.
 * @returns deterministic OpenTelemetry span id.
 */
export function messageSpanId(project: string, origin: 'live' | 'replay', session: string, message: string): string {
  const ids = new SourceIds()
  ids.key = JSON.stringify([project, origin, `${session}/message/${message}`])
  return ids.generateSpanId()
}

/** Idempotent reconciliation serialized across processes sharing a DSH home. */
export class FeedbackPublisher {
  private readonly stop = new AbortController()
  private timer: ReturnType<typeof setInterval> | undefined
  private work: Promise<void> | undefined
  private requested = false
  private readonly revisions = new Map<string, unknown>()
  private readonly published = new Map<string, string>()
  constructor(private readonly settings: Settings, private readonly policy: ContentPolicy,
    private readonly stats: Diagnostics, private readonly sources: FeedbackSources) {}

  /** Begin startup recovery and periodic reconciliation; the caller owns shutdown. */
  start(): void {
    if (this.timer || this.stop.signal.aborted) return
    this.timer = setInterval(() => this.request(), this.settings.feedback.reconcileIntervalMillis)
    this.timer.unref()
    this.request()
  }

  /** Coalesce notifications without awaiting a feedback writer's lock. */
  request(): void {
    if (this.stop.signal.aborted) return
    this.requested = true
    if (this.work) return
    this.work = this.runRequested().catch(() => { this.stats.feedbackFailures++ }).finally(() => {
      this.work = undefined
      if (this.requested && !this.stop.signal.aborted) this.request()
    })
  }

  private async runRequested(): Promise<void> {
    while (this.requested && !this.stop.signal.aborted) {
      this.requested = false
      await this.reconcile()
    }
  }

  /** Rebuild annotations from durable mutations under a nonblocking kernel lock.
   * @returns completion of this pass; a competing process owns any skipped pass.
   */
  async reconcile(): Promise<void> {
    const config = this.settings.feedback
    const directory = config.stateDirectory ?? path.join(resolveDshHome(), 'gh-genai-traces')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const lock = await open(path.join(directory, `${digest([config.endpoint, this.settings.project])}.lock`), 'a', 0o600)
    try {
      try { await tryLockExclusive(lock.fd) } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && ['EAGAIN', 'EWOULDBLOCK'].includes(String(error.code))) return
        throw error
      }
      this.stats.feedbackPending = 0
      await this.sources.flush()
      for (const id of await this.sources.list()) {
        if (this.stop.signal.aborted) break
        try {
          const revision = await this.sources.revision(id)
          if (revision !== undefined && this.revisions.has(id) && this.revisions.get(id) === revision) continue
          const snapshot = await this.sources.read(id)
          let complete = true
          for (const [message, event] of feedbackMutations(snapshot)) {
            if (this.stop.signal.aborted) break
            this.stats.feedbackPending++
            const key = JSON.stringify([id, message]), fingerprint = digest(event)
            try {
              if (this.published.get(key) !== fingerprint) {
                await this.publish(snapshot, message, event)
                this.published.set(key, fingerprint)
              }
              this.stats.feedbackPending--
            } catch { complete = false; if (!this.stop.signal.aborted) this.stats.feedbackFailures++ }
          }
          if (complete && !this.stop.signal.aborted && revision !== undefined && await this.sources.revision(id) === revision) this.revisions.set(id, revision)
        } catch { if (!this.stop.signal.aborted) this.stats.feedbackFailures++ }
      }
    } finally { await lock.close() }
  }

  private async requestHttp(route: string, method: 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
    const config = this.settings.feedback
    const response = await fetch(`${config.endpoint.replace(/\/$/, '')}${route}`, {
      method, headers: { ...config.headers, 'content-type': 'application/json' },
      signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(config.requestTimeoutMillis)]),
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
    await response.body?.cancel()
    if (response.status === 404) return false
    if (!response.ok) throw Error(`Phoenix feedback HTTP ${response.status}`)
    return true
  }

  private async remove(project: string, identifier: string): Promise<void> {
    // Phoenix requires an unbounded-time acknowledgement even with an exact identifier filter.
    const query = new URLSearchParams({ identifier, name: annotationName, annotator_kind: 'HUMAN', delete_all: 'true' })
    await this.requestHttp(`/v1/projects/${encodeURIComponent(project)}/span_annotations?${query}`, 'DELETE')
  }

  private async publish(snapshot: SessionLogSnapshot, message: string, event: RatingEvent): Promise<void> {
    const session = String(snapshot.session.id), project = this.settings.project, replayProject = `${project}-replay`
    const identifier = `dsh:rating:v4:${digest([session, message])}`
    if (event.type === 'feedback/message-delete') {
      await this.remove(project, identifier)
      await this.remove(replayProject, identifier)
      return
    }
    let owner = snapshot
    const visited = new Set<string>()
    for (;;) {
      if (visited.has(String(owner.session.id))) throw Error('Feedback ancestry contains a cycle')
      visited.add(String(owner.session.id))
      const target = owner.events.find(e => e.type === 'assistant/message' && e.data.message.id === message)
      if (!target) throw Error('Feedback target is missing from its ancestry')
      if (target.seq >= owner.inheritedEventCount) break
      if (!owner.session.parentSession) throw Error('Inherited feedback target has no parent Session')
      owner = await this.sources.read(String(owner.session.parentSession))
    }
    const ownerSession = String(owner.session.id)
    const filtered = this.sources.redact(snapshot, structuredClone(event))
    if (filtered.type !== 'feedback/message-put' || filtered.data.sessionId !== session || filtered.data.item.messageId !== message) throw Error('Feedback identity was withheld')
    const item = filtered.data.item
    if (!['positive', 'negative'].includes(item.rating)) throw Error('Feedback rating was withheld')
    const note = item.note === undefined ? { 'gh.content.feedback.note.status': 'absent' } : this.policy.attributes('feedback.note', item.note)
    const metadata = { sessionId: session, messageOwnerSessionId: ownerSession, messageId: message, feedbackVersion: item.version, sourceEvent: event.seq,
      createdAt: item.createdAt, updatedAt: item.updatedAt, category: item.category ?? null, mappingVersion: 4,
      noteCapture: note['gh.content.feedback.note.status'], preferenceOnly: true }
    const result = { label: item.rating, score: item.rating === 'positive' ? 1 : 0,
      ...typeof note['feedback.note'] === 'string' ? { explanation: JSON.parse(note['feedback.note']) as string } : {} }
    const put = (destination: string, origin: 'live' | 'replay') => this.requestHttp('/v1/span_annotations?sync=true', 'POST', {
      data: [{ span_id: messageSpanId(destination, origin, ownerSession, message), name: annotationName, annotator_kind: 'HUMAN', identifier, result, metadata }],
    })
    if (await put(project, 'live')) { await this.remove(replayProject, identifier); return }
    if (await put(replayProject, 'replay')) return
    await this.sources.replay(ownerSession)
    if (!await put(replayProject, 'replay')) throw Error('Feedback span is awaiting Phoenix ingestion')
  }

  /** Cancel HTTP work, stop notifications, and release the reconciliation lock.
   * @returns completion after the owned worker exits.
   */
  async shutdown(): Promise<void> {
    clearInterval(this.timer)
    this.stop.abort()
    await this.work
  }
}
