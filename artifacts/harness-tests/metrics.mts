/**
 * Offline metric extractor over a decoded session log.
 *
 * Follows the fold documented in `packages/session/session-stats/README.md`
 * (`steps`, `turns`, `llmMs`, `ttftMs`, `decodeMs`, `decodeTokens`, `toolMs`) plus
 * per-step token usage, because `session-stats` is mounted only in the web-app
 * bundle and serves a client projection rather than anything a headless run can
 * read back. Everything comes from events the log already carries, so it works
 * retroactively on every session ever recorded and needs no instrumentation.
 *
 * Usage:
 *   node --import tsx/esm artifacts/harness-tests/metrics.mts <decoded.jsonl> [...]
 *   node --import tsx/esm artifacts/harness-tests/metrics.mts --all   # every ~/.dsh session
 *
 * Input is the DECODED log (see `artifacts/read-session-log.mts`; the on-disk file
 * is concatenated zstd frames and a single-frame decode returns only the header).
 * Prints one JSON object per session to stdout, plus a `{file, decodeError}`
 * record for any session `--all` could not decode.
 *
 * **The timing definitions are the projection's, not approximations of it.**
 * `sessionStats` is the authority (`packages/session/session-stats/src/projection.ts`):
 * model time is `step/start` → `assistant/message`, first token is the first
 * **non-empty** delta chunk, and decode spans **first token → the assembled
 * message** on steps that also report output tokens. Every duration is clamped at
 * zero, because a packed row's gap encoding permits clock reversal and a real
 * `dt: -60` exists in a recorded log.
 *
 * Three log-format facts this fold depends on, each verified against a real log
 * because assuming any of them produces plausible wrong numbers:
 *
 * - **Delta chunks are stored two ways.** A run of at least `MIN_RUN` = 3
 *   consecutive compatible deltas packs into one `reasoning-chunks` /
 *   `text-chunks` / `tool-call-chunks` row carrying `seq0`/`time0` and
 *   member-to-member gaps in `data.dt`; anything shorter stays as ordinary
 *   `assistant/chunk` events. A fold that reads only packed rows reports TTFT and
 *   decode as **zero** for every short response, and one that reads only
 *   `assistant/chunk` finds `block-start` and reports a TTFT near the whole model
 *   time. This module expands rows through the product's own
 *   `decodeStorageRecord`, so both layouts fold identically and neither the gap
 *   arithmetic nor the `MIN_RUN` threshold is restated here.
 * - **The session header has no `time`** — it carries `createdAt`, and its `id`
 *   sits at the top level rather than under `data`.
 * - **`tool/call` is flat** (`data.callId`, `data.name`), while `tool/result`
 *   nests its id under `data.message.source.callId`.
 *
 * One honesty limit, measured rather than suspected, and it is not a defect in the
 * log: `recproxy.py` forwards 4 KiB reads rather than SSE events, so it buffers the
 * response and collapses every gap to 0-1 ms. The same E2 gate task run both ways
 * on the same revision and route, **n=1 per arm** — enough to establish that the
 * proxy destroys the split, not enough to publish a decode rate:
 *
 * | | TTFT | decode |
 * |---|---|---|
 * | through `recproxy.py` | 20,897 ms | 160 ms / 779 tok (impossible) |
 * | direct to the gateway | 514-1,038 ms | 15,036 ms / 738 tok |
 *
 * So the TTFT/decode split is only valid on a run that did NOT go through the
 * recording proxy. `llmMs`, token counts and every non-timing field stay valid
 * either way, because they do not depend on when deltas arrived.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeStorageRecord } from '../../packages/core/session/src/chunk-rows.ts'
import type { StreamChunk } from '../../packages/llm/llm/src/types.ts'

/**
 * Whether a stream chunk carries a non-empty first-token delta.
 *
 * Mirrors the predicate in `packages/session/session-stats/src/projection.ts`,
 * which stays the authority for every timing definition this fold follows.
 * That projection keeps the predicate private and upstream's client projections
 * carry their own copies, so this one is vendored rather than imported: an
 * `artifacts/` import of a product export can be withdrawn upstream without any
 * merge conflict (artifacts/AGENTS.md, "Our instruments import product source").
 *
 * Chunk kinds other than a text, reasoning, or tool-call delta are not first
 * tokens; `StreamChunk` is merge-extensible, so a new kind falls through.
 */
function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** One session event, read structurally — the log is the authority on its shape. */
interface Event {
  type: string
  seq?: number
  time?: number
  id?: string
  createdAt?: number
  data?: Record<string, unknown>
}

/** Per-step figures. A step is one model request plus the tool calls it produced. */
interface Step {
  turn: number
  step: number
  inputTokens?: number
  outputTokens?: number
  /** `step/start` → the first non-empty streamed delta. */
  ttftMs?: number
  /** `step/start` → the assembled `assistant/message`. */
  llmMs?: number
  /** First non-empty streamed delta → the assembled `assistant/message`. */
  decodeMs?: number
}

/** One compaction attempt, from the events that bound it. */
interface Compaction {
  /** Surface nodes the summary replaced. Zero means nothing was compacted, whatever the command reported. */
  shadowedSeqs: number
  shadowedTokenCount: number
  /** The route that wrote the summary, and the cap it sent. */
  provider?: string
  model?: string
  maxTokens?: number
  /** `compaction/end`'s error text, when the attempt failed. */
  error?: string
}

/**
 * Lines the fold could not use. Non-zero values mean the figures below cover
 * less than the session, so they are reported rather than dropped: a silent
 * skip is indistinguishable from a clean log.
 */
interface Losses {
  /** Unparseable lines before the last one — a writer defect, not a torn tail. */
  interiorParseErrors: number
  /** An unparseable final line, which is the ordinary shape of a killed writer. */
  trailingParseError: boolean
  /** Packed rows the product decoder rejected as corrupt. */
  malformedRows: number
}

/** Whole-session figures plus the per-step detail behind them. */
interface SessionMetrics {
  file: string
  sessionId?: string
  title?: string
  route?: { provider?: string; model?: string; maxTokens?: number; reasoningEffort?: string }
  turns: number
  steps: number
  llmMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
  /** Sum of matched `tool/call` → `tool/result` pairs. */
  toolMs: number
  toolCalls: number
  /** Which tools this session actually exercised, and how often. */
  toolNames: Record<string, number>
  toolErrors: { tool: string; name: string; code: string }[]
  promptTokens: number[]
  outputTokens: number[]
  turnEndReasons: string[]
  /** First to last timestamped event. */
  wallMs: number
  /** Compaction ATTEMPTS, one per `compaction/end` — not the three events each one appends. */
  compactions: number
  compactionDetail: Compaction[]
  approvals: { event: string; outcome?: string }[]
  auxCalls: { kind: string; provider?: string }[]
  losses: Losses
  perStep: Step[]
}

/** A session `--all` could not decode, reported in place of its figures. */
interface SessionDecodeFailure {
  file: string
  decodeError: string
}

/** A step key stable across the interleaved events of one session. */
function stepKey(turn: unknown, step: unknown): string {
  return `${String(turn)}:${String(step)}`
}

/** Elapsed milliseconds, clamped: the packed gap encoding permits clock reversal. */
function elapsed(from: number, to: number): number {
  return Math.max(0, to - from)
}

/**
 * Read a decoded log into session events, expanding packed chunk rows through
 * the product's own decoder so both storage layouts fold identically.
 * @param file Path to the decoded JSONL.
 * @returns The events in log order, and what could not be read.
 */
function readEvents(file: string): { events: Event[]; losses: Losses } {
  const lines = readFileSync(file, 'utf8').split('\n')
  const events: Event[] = []
  const losses: Losses = { interiorParseErrors: 0, trailingParseError: false, malformedRows: 0 }
  for (const [i, line] of lines.entries()) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      // A truncated FINAL line means the writer died mid-append and earlier
      // events stay valid; an interior one is a defect that hides events.
      if (i === lines.length - 1) losses.trailingParseError = true
      else losses.interiorParseErrors += 1
      continue
    }
    try {
      events.push(...decodeStorageRecord(value) as unknown as Event[])
    } catch {
      // decodeStorageRecord fails loud on a corrupt packed row rather than
      // silently dropping the run it stores. Counted, so the loss is visible.
      losses.malformedRows += 1
    }
  }
  return { events, losses }
}

/**
 * Fold one decoded session log into its metrics.
 * @param file Path to the decoded JSONL.
 * @returns The session's figures, or undefined when the file holds no events.
 */
export function foldSession(file: string): SessionMetrics | undefined {
  const { events, losses } = readEvents(file)
  if (events.length === 0) return undefined

  const times = events.map(e => e.time).filter((t): t is number => t !== undefined)
  const m: SessionMetrics = {
    file,
    turns: 0,
    steps: 0,
    llmMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    toolMs: 0,
    toolCalls: 0,
    toolNames: {},
    toolErrors: [],
    promptTokens: [],
    outputTokens: [],
    turnEndReasons: [],
    wallMs: times.length === 0 ? 0 : elapsed(Math.min(...times), Math.max(...times)),
    compactions: 0,
    compactionDetail: [],
    approvals: [],
    auxCalls: [],
    losses,
    perStep: [],
  }

  const steps = new Map<string, Step>()
  const startedAt = new Map<string, number>()
  const firstTokenAt = new Map<string, number>()
  const toolCallAt = new Map<string, number>()
  const toolCallName = new Map<string, string>()
  const countedTurns = new Set<number>()
  const openCompaction = new Map<string, Compaction>()

  const step = (turn: unknown, s: unknown): Step => {
    const k = stepKey(turn, s)
    let found = steps.get(k)
    if (found === undefined) {
      found = { turn: Number(turn), step: Number(s) }
      steps.set(k, found)
    }
    return found
  }

  for (const e of events) {
    const d = e.data ?? {}

    switch (e.type) {
      case 'session': {
        m.sessionId = e.id
        break
      }
      case 'session/title': {
        if (typeof d['title'] === 'string') m.title = d['title']
        break
      }
      case 'request/header': {
        const header = d['header'] as Record<string, unknown> | undefined
        m.route ??= header?.['config'] as SessionMetrics['route']
        break
      }
      case 'session/title-llm-request': {
        const route = d['route'] as { provider?: string } | undefined
        m.auxCalls.push({ kind: 'title', provider: route?.provider })
        break
      }
      case 'step/start': {
        if (e.time !== undefined) startedAt.set(stepKey(d['turn'], d['step']), e.time)
        break
      }
      case 'step/end': {
        // Counted here rather than from assembled messages: the loop appends
        // exactly one per entered step in a `finally`, so failed, cancelled and
        // max-tokens steps all count.
        m.steps += 1
        const turn = Number(d['turn'])
        if (!Number.isNaN(turn)) countedTurns.add(turn)
        break
      }
      case 'assistant/chunk': {
        const chunk = d['chunk'] as Record<string, unknown> | undefined
        if (chunk === undefined) break
        const k = stepKey(d['turn'], d['step'])
        if (String(chunk['type']) === 'usage') {
          const usage = chunk['usage'] as { inputTokens?: number; outputTokens?: number } | undefined
          const s = step(d['turn'], d['step'])
          s.inputTokens = usage?.inputTokens
          s.outputTokens = usage?.outputTokens
          break
        }
        // The projection's first-token rule: the first delta carrying content.
        // A tool-call run commonly begins `args: [""]`, and an empty member is
        // not a token — taking it would understate TTFT by the whole first gap.
        if (e.time !== undefined && !firstTokenAt.has(k) && isTokenDelta(chunk as unknown as StreamChunk)) {
          firstTokenAt.set(k, e.time)
        }
        break
      }
      case 'assistant/message': {
        const k = stepKey(d['turn'], d['step'])
        const s = step(d['turn'], d['step'])
        const start = startedAt.get(k)
        if (start !== undefined && e.time !== undefined) {
          s.llmMs = elapsed(start, e.time)
          m.llmMs += s.llmMs
        }
        const first = firstTokenAt.get(k)
        if (first !== undefined && start !== undefined) {
          s.ttftMs = elapsed(start, first)
          m.ttftMs += s.ttftMs
          m.ttftSteps += 1
        }
        // Decode ends at the assembled message, matching `sessionStats`. The
        // last delta is NOT the end: assembly, finish and usage chunks land
        // after it, and a fold that stops at the last delta reports a decode
        // window shorter than the model actually spent producing the answer.
        if (first !== undefined && e.time !== undefined && s.outputTokens !== undefined) {
          s.decodeMs = elapsed(first, e.time)
          m.decodeMs += s.decodeMs
          m.decodeTokens += s.outputTokens
        }
        break
      }
      case 'tool/call': {
        const id = d['callId']
        const name = typeof d['name'] === 'string' ? d['name'] : 'unknown'
        if (typeof id === 'string') {
          if (e.time !== undefined) toolCallAt.set(id, e.time)
          toolCallName.set(id, name)
        }
        m.toolCalls += 1
        m.toolNames[name] = (m.toolNames[name] ?? 0) + 1
        break
      }
      case 'tool/result': {
        const message = d['message'] as Record<string, unknown> | undefined
        const source = message?.['source'] as Record<string, unknown> | undefined
        const id = source?.['callId']
        let tool = 'unknown'
        if (typeof id === 'string') {
          tool = toolCallName.get(id) ?? 'unknown'
          const at = toolCallAt.get(id)
          if (at !== undefined && e.time !== undefined) {
            m.toolMs += elapsed(at, e.time)
            toolCallAt.delete(id)
          }
        }
        const error = d['error'] as { name?: string; code?: string } | null | undefined
        if (error != null) m.toolErrors.push({ tool, name: String(error.name), code: String(error.code) })
        break
      }
      case 'turn/end': {
        const reason = d['reason'] as { kind?: string } | undefined
        m.turnEndReasons.push(String(reason?.kind))
        break
      }
      case 'compaction/summary': {
        const seqs = d['shadowedSeqs']
        openCompaction.set(String(d['compactionId']), {
          shadowedSeqs: Array.isArray(seqs) ? seqs.length : 0,
          shadowedTokenCount: Number(d['shadowedTokenCount'] ?? 0),
          ...typeof d['provider'] === 'string' ? { provider: d['provider'] } : {},
          ...typeof d['model'] === 'string' ? { model: d['model'] } : {},
          ...typeof d['maxTokens'] === 'number' ? { maxTokens: d['maxTokens'] } : {},
        })
        break
      }
      case 'compaction/end': {
        // One attempt per `compaction/end`. Counting every `compaction/*` event
        // reports 3 for one successful compaction, which reads as three.
        m.compactions += 1
        const id = String(d['compactionId'])
        const detail = openCompaction.get(id) ?? { shadowedSeqs: 0, shadowedTokenCount: 0 }
        openCompaction.delete(id)
        m.compactionDetail.push({
          ...detail,
          ...typeof d['error'] === 'string' ? { error: d['error'] } : {},
        })
        break
      }
      default: {
        // Merge-extensible vocabulary: plugins add event types this fold has
        // never heard of, and ignoring them is correct.
        if (e.type.startsWith('approval')) {
          const outcome = d['outcome']
          m.approvals.push({
            event: e.type,
            ...typeof outcome === 'string' ? { outcome } : {},
          })
        }
        break
      }
    }
  }

  m.turns = countedTurns.size
  m.perStep = [...steps.values()].sort((a, b) => a.turn - b.turn || a.step - b.step)
  m.promptTokens = m.perStep.map(s => s.inputTokens ?? 0).filter(v => v > 0)
  m.outputTokens = m.perStep.map(s => s.outputTokens ?? 0).filter(v => v > 0)
  return m
}

/**
 * Decode every session under `$DSH_HOME/sessions` into a temp dir and fold it.
 * @returns One record per session, oldest first; a decode failure reports itself.
 */
function foldAll(): (SessionMetrics | SessionDecodeFailure)[] {
  const home = process.env['DSH_HOME'] ?? join(process.env['HOME'] ?? '', '.dsh')
  const logs: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.jsonl.zstd')) logs.push(path)
    }
  }
  walk(join(home, 'sessions'))
  const out = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
  const decoder = join(dirname(fileURLToPath(import.meta.url)), '..', 'read-session-log.mts')
  const results: (SessionMetrics | SessionDecodeFailure)[] = []
  for (const [i, log] of logs.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).entries()) {
    const target = join(out, `s${i}.jsonl`)
    try {
      execFileSync(process.execPath, ['--import', 'tsx/esm', decoder, log, target], { stdio: 'pipe' })
    } catch (error) {
      // An omitted session is selection bias: a log fails to decode for
      // reasons (a torn frame on a live session) that correlate with what is
      // being measured, so it is reported in the output rather than skipped.
      results.push({ file: log, decodeError: String((error as { message?: string }).message ?? error).slice(0, 300) })
      continue
    }
    const folded = foldSession(target)
    results.push(folded === undefined ? { file: log, decodeError: 'decoded to zero events' } : { ...folded, file: log })
  }
  return results
}

const args = process.argv.slice(2)
if (args.length === 0) {
  process.stderr.write('usage: metrics.mts <decoded.jsonl>... | --all\n')
  process.exit(2)
}
const records: (SessionMetrics | SessionDecodeFailure)[] = args[0] === '--all'
  ? foldAll()
  : args.map(foldSession).filter((r): r is SessionMetrics => r !== undefined)
for (const record of records) process.stdout.write(`${JSON.stringify(record)}\n`)
const failures = records.filter((r): r is SessionDecodeFailure => 'decodeError' in r).length
const lossy = records.filter(r => 'losses' in r && (r.losses.interiorParseErrors > 0 || r.losses.malformedRows > 0)).length
if (failures > 0 || lossy > 0) {
  process.stderr.write(`metrics: ${failures} session(s) failed to decode, ${lossy} folded with losses\n`)
}
