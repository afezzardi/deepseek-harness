/**
 * Offline v2-only session metrics. Run with JSONL/.zstd paths or --all.
 * Timing follows session-stats: step start to first non-empty embedded delta,
 * and first delta to assembled message. Recording proxies can distort timing.
 */

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandAssistantStream, type AssistantStreamRecord } from '../../packages/llm/llm/src/assistant-stream.ts'
import { readV2Log } from './v2-log.mts'
import type { StreamChunk } from '../../packages/llm/llm/src/types.ts'

/** First-token predicate shared semantically with session-stats/projection.ts. */
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
 * Fold one decoded session log into its metrics.
 * @param file Path to the decoded JSONL.
 * @returns The session's figures; invalid or non-v2 input throws.
 */
export function foldSession(file: string): SessionMetrics {
  const events = readV2Log(file)

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
        startedAt.delete(stepKey(d['turn'], d['step']))
        firstTokenAt.delete(stepKey(d['turn'], d['step']))
        m.steps += 1
        const turn = Number(d['turn'])
        if (!Number.isNaN(turn)) countedTurns.add(turn)
        break
      }
      case 'assistant/attempt': {
        const k = stepKey(d['turn'], d['step'])
        const first = expandAssistantStream(d['stream'] as AssistantStreamRecord[]).find(x => isTokenDelta(x.chunk))
        if (first !== undefined && !firstTokenAt.has(k)) firstTokenAt.set(k, first.time)
        break
      }
      case 'assistant/message': {
        const k = stepKey(d['turn'], d['step'])
        const s = step(d['turn'], d['step'])
        const stream = expandAssistantStream(d['stream'] as AssistantStreamRecord[])
        const token = stream.find(x => isTokenDelta(x.chunk))
        if (token !== undefined && !firstTokenAt.has(k)) firstTokenAt.set(k, token.time)
        const usage = d['usage'] as { inputTokens?: number; outputTokens?: number } | undefined
        s.inputTokens = usage?.inputTokens
        s.outputTokens = usage?.outputTokens
        const start = startedAt.get(k)
        if (start === undefined) break
        startedAt.delete(k)
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
        toolCallAt.clear()
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
 * Fold only v2 logs under `$DSH_HOME/sessions` without counting old generations.
 * @returns One record per session, oldest first; a decode failure reports itself.
 */
function foldAll(): (SessionMetrics | SessionDecodeFailure)[] {
  const home = process.env['DSH_HOME'] ?? join(process.env['HOME'] ?? '', '.dsh')
  const logs: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'session.v2.jsonl.zstd' || entry.name === 'session.v2.jsonl') logs.push(path)
    }
  }
  walk(join(home, 'sessions'))
  const results: (SessionMetrics | SessionDecodeFailure)[] = []
  for (const log of logs.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)) {
    try {
      const folded = foldSession(log)
      results.push({ ...folded, file: log })
    } catch (error) {
      // An omitted session is selection bias: a log fails to decode for
      // reasons (a torn frame on a live session) that correlate with what is
      // being measured, so it is reported in the output rather than skipped.
      results.push({ file: log, decodeError: String((error as { message?: string }).message ?? error).slice(0, 300) })
      continue
    }
  }
  return results
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    process.stderr.write('usage: metrics.mts <session.v2.jsonl[.zstd]>... | --all\n')
    process.exit(2)
  }
  const records: (SessionMetrics | SessionDecodeFailure)[] = args[0] === '--all'
    ? foldAll()
    : args.map(foldSession)
  for (const record of records) process.stdout.write(`${JSON.stringify(record)}\n`)
  const failures = records.filter((r): r is SessionDecodeFailure => 'decodeError' in r).length
  if (failures > 0) {
    process.stderr.write(`metrics: ${failures} session(s) failed to decode\n`)
    process.exitCode = 1
  }
  if (records.length === 0) {
    process.stderr.write('metrics: no v2 sessions found; run the fresh UAT first\n')
    process.exitCode = 1
  }
}
