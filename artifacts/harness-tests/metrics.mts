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
 * Prints one JSON object per session to stdout.
 *
 * Three log-format facts this fold depends on, each verified against a real log
 * because assuming any of them produces plausible wrong numbers:
 *
 * - **Content deltas live in PACKED rows**, not in `assistant/chunk`. The rows are
 *   `reasoning-chunks` / `text-chunks` / `tool-call-chunks`, and they carry
 *   top-level `seq0`/`time0` instead of `seq`/`time`, with `data.dt` holding
 *   per-delta millisecond increments. `assistant/chunk` carries only block
 *   boundaries, usage and finish. A fold that looks for deltas in
 *   `assistant/chunk` finds `block-start` and reports a time-to-first-token
 *   almost equal to the whole model time.
 * - **The session header has no `time`** — it carries `createdAt`, and its `id`
 *   sits at the top level rather than under `data`.
 * - **`tool/call` is flat** (`data.callId`, `data.name`), while `tool/result`
 *   nests ids under `data.message.content[].toolCallId`.
 *
 * One honesty limit, measured rather than suspected, and it is not a defect in the
 * log: `recproxy.py` buffers the response, collapsing every `dt` to 0-1 ms. The
 * same E2 gate task run both ways, on the same revision and route:
 *
 * | | TTFT | decode | implied rate |
 * |---|---|---|---|
 * | through `recproxy.py` | 20,897 ms | 160 ms / 779 tok | 4,869 tok/s (impossible) |
 * | direct to the gateway | 514-1,038 ms | 15,036 ms / 738 tok | **49 tok/s** |
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

/** Packed-row types carrying streamed content deltas, in `data.dt` order. */
const PACKED_DELTA_ROWS = new Set(['reasoning-chunks', 'text-chunks', 'tool-call-chunks'])

/** One session event, read structurally — the log is the authority on its shape. */
interface Event {
  type: string
  seq?: number
  time?: number
  seq0?: number
  time0?: number
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
  /** `step/start` → the first streamed content delta. */
  ttftMs?: number
  /** `step/start` → the assembled `assistant/message`. */
  llmMs?: number
  /** First streamed delta → last streamed delta. */
  decodeMs?: number
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
  toolErrors: { name: string; code: string }[]
  promptTokens: number[]
  outputTokens: number[]
  turnEndReasons: string[]
  /** First to last timestamped event. */
  wallMs: number
  compactions: number
  approvals: { event: string; outcome?: string }[]
  auxCalls: { kind: string; provider?: string }[]
  perStep: Step[]
}

/** A step key stable across the interleaved events of one session. */
function stepKey(turn: unknown, step: unknown): string {
  return `${String(turn)}:${String(step)}`
}

/**
 * The wall-clock time an event was appended, across both envelope layouts.
 * @param event The event to read.
 * @returns Epoch milliseconds, or undefined for the untimestamped header.
 */
function eventTime(event: Event): number | undefined {
  return event.time ?? event.time0
}

/**
 * Fold one decoded session log into its metrics.
 * @param file Path to the decoded JSONL.
 * @returns The session's figures, or undefined when the file holds no events.
 */
export function foldSession(file: string): SessionMetrics | undefined {
  const events: Event[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line) as Event)
    } catch {
      // A truncated trailing line means the writer died mid-append. Earlier events
      // stay valid and nothing in this fold reads across lines.
    }
  }
  if (events.length === 0) return undefined

  const times = events.map(eventTime).filter((t): t is number => t !== undefined)
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
    wallMs: times.length === 0 ? 0 : Math.max(...times) - Math.min(...times),
    compactions: 0,
    approvals: [],
    auxCalls: [],
    perStep: [],
  }

  const steps = new Map<string, Step>()
  const startedAt = new Map<string, number>()
  const firstDeltaAt = new Map<string, number>()
  const lastDeltaAt = new Map<string, number>()
  const toolCallAt = new Map<string, number>()
  const countedTurns = new Set<number>()

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

    // Packed delta rows bound the streaming window. `dt` increments are relative
    // to `time0`, so the row's last delta is time0 + the sum of its increments.
    if (PACKED_DELTA_ROWS.has(e.type)) {
      const k = stepKey(d['turn'], d['step'])
      const base = e.time0
      if (base === undefined) continue
      const dt = Array.isArray(d['dt']) ? (d['dt'] as number[]) : []
      const end = base + dt.reduce((a, b) => a + (Number(b) || 0), 0)
      if (!firstDeltaAt.has(k) || base < firstDeltaAt.get(k)!) firstDeltaAt.set(k, base)
      if (!lastDeltaAt.has(k) || end > lastDeltaAt.get(k)!) lastDeltaAt.set(k, end)
      continue
    }

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
        const t = eventTime(e)
        if (t !== undefined) startedAt.set(stepKey(d['turn'], d['step']), t)
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
        if (chunk !== undefined && String(chunk['type']) === 'usage') {
          const usage = chunk['usage'] as { inputTokens?: number; outputTokens?: number } | undefined
          const s = step(d['turn'], d['step'])
          s.inputTokens = usage?.inputTokens
          s.outputTokens = usage?.outputTokens
        }
        break
      }
      case 'assistant/message': {
        const k = stepKey(d['turn'], d['step'])
        const s = step(d['turn'], d['step'])
        const start = startedAt.get(k)
        const t = eventTime(e)
        if (start !== undefined && t !== undefined) {
          s.llmMs = t - start
          m.llmMs += s.llmMs
        }
        const first = firstDeltaAt.get(k)
        if (first !== undefined && start !== undefined) {
          s.ttftMs = first - start
          m.ttftMs += s.ttftMs
          m.ttftSteps += 1
        }
        const last = lastDeltaAt.get(k)
        if (first !== undefined && last !== undefined && s.outputTokens !== undefined) {
          s.decodeMs = last - first
          m.decodeMs += s.decodeMs
          m.decodeTokens += s.outputTokens
        }
        break
      }
      case 'tool/call': {
        const id = d['callId']
        const t = eventTime(e)
        if (typeof id === 'string' && t !== undefined) toolCallAt.set(id, t)
        m.toolCalls += 1
        const name = typeof d['name'] === 'string' ? d['name'] : 'unknown'
        m.toolNames[name] = (m.toolNames[name] ?? 0) + 1
        break
      }
      case 'tool/result': {
        const message = d['message'] as Record<string, unknown> | undefined
        const content = (message?.['content'] ?? []) as Record<string, unknown>[]
        const t = eventTime(e)
        for (const part of content) {
          const id = part['toolCallId']
          if (typeof id !== 'string') continue
          const at = toolCallAt.get(id)
          if (at !== undefined && t !== undefined) {
            m.toolMs += t - at
            toolCallAt.delete(id)
          }
        }
        const error = d['error'] as { name?: string; code?: string } | null | undefined
        if (error != null) m.toolErrors.push({ name: String(error.name), code: String(error.code) })
        break
      }
      case 'turn/end': {
        const reason = d['reason'] as { kind?: string } | undefined
        m.turnEndReasons.push(String(reason?.kind))
        break
      }
      default: {
        // Merge-extensible vocabulary: plugins add event types this fold has never
        // heard of, and ignoring them is correct. Two families are matched by
        // prefix because their membership grows.
        if (e.type.startsWith('compaction')) m.compactions += 1
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
 * @returns One record per decodable session, oldest first.
 */
function foldAll(): SessionMetrics[] {
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
  const results: SessionMetrics[] = []
  for (const [i, log] of logs.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).entries()) {
    const target = join(out, `s${i}.jsonl`)
    try {
      execFileSync(process.execPath, ['--import', 'tsx/esm', decoder, log, target], { stdio: 'ignore' })
    } catch {
      continue // An undecodable log is reported by its absence from the results.
    }
    const folded = foldSession(target)
    if (folded !== undefined) results.push({ ...folded, file: log })
  }
  return results
}

const args = process.argv.slice(2)
if (args.length === 0) {
  process.stderr.write('usage: metrics.mts <decoded.jsonl>... | --all\n')
  process.exit(2)
}
const records = args[0] === '--all'
  ? foldAll()
  : args.map(foldSession).filter((r): r is SessionMetrics => r !== undefined)
for (const record of records) process.stdout.write(`${JSON.stringify(record)}\n`)
