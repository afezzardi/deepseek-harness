/**
 * Log-level PASS/FAIL for one UAT case, over a decoded session log.
 *
 * Four cases in [UAT.md](../UAT.md) can be recorded PASS from the screen while
 * the thing under test never ran. This checker asserts the criteria that
 * distinguish them, from the log rather than from stdout:
 *
 * - **B1.4** passes on screen if the model merely declines — same message, same
 *   absent file — so the criterion is that `write` was actually CALLED and the
 *   fence rejected it with `FS_SANDBOX_DENIED`.
 * - **B3.1 / B3.2** pass on screen from the model's own account of the outcome,
 *   which is prose. The criterion is the `approval/decided` outcome plus the
 *   tool result and the file on disk agreeing with it.
 * - **B4.1** passes on screen when `/compact` reports success having replaced
 *   nothing, because the original first message is then still in history. The
 *   criterion is `compaction/summary.shadowedSeqs` being non-empty.
 *
 * Usage (via [check.sh](check.sh), which decodes the log first):
 *   node --import tsx/esm artifacts/harness-tests/check-case.mts <case-id> <decoded.jsonl>
 *
 * Paths are compared against `process.cwd()` as the workspace root, so run it
 * from the repo root. Exit status is 0 when every criterion passed, 1 otherwise.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/** One session event, read structurally — the log is the authority on its shape. */
interface Event {
  type: string
  seq?: number
  time?: number
  seq0?: number
  time0?: number
  data?: Record<string, unknown>
}

/** One asserted criterion and what the log said about it. */
interface Check {
  name: string
  pass: boolean
  detail: string
}

/** A tool call paired with the result that closed it, when one landed. */
interface Call {
  turn: number
  step: number
  callId: string
  name: string
  args: Record<string, unknown>
  /**
   * The `arguments` string did not parse as JSON, so no named field is
   * readable. Reported rather than dropped: a criterion that reads
   * `file_path` would otherwise report the call as absent, which is the
   * opposite conclusion.
   */
  argsUnparsed?: true
  error?: { name?: string; code?: string }
  isError?: boolean
  text: string
}

/**
 * Parse a decoded log into events, reporting rather than hiding a bad line.
 * @param file Path to the decoded JSONL.
 * @returns The parseable events, in log order.
 */
function readEvents(file: string): Event[] {
  const events: Event[] = []
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line) as Event)
    } catch {
      process.stderr.write(`check-case: unparseable line ${i + 1} skipped\n`)
    }
  }
  return events
}

/**
 * Pair every `tool/call` with its `tool/result` by callId.
 * @param events The decoded log, in order.
 * @returns One entry per call, in call order.
 */
function toolCalls(events: Event[]): Call[] {
  const byId = new Map<string, Call>()
  const order: Call[] = []
  for (const e of events) {
    const d = e.data ?? {}
    if (e.type === 'tool/call') {
      const id = String(d['callId'])
      let args: Record<string, unknown> = {}
      let unparsed = false
      try {
        args = JSON.parse(String(d['arguments'] ?? '{}')) as Record<string, unknown>
      } catch {
        unparsed = true // Surfaced by the criteria; see Call.argsUnparsed.
      }
      const call: Call = {
        turn: Number(d['turn']),
        step: Number(d['step']),
        callId: id,
        name: String(d['name']),
        args,
        ...unparsed ? { argsUnparsed: true as const } : {},
        text: '',
      }
      byId.set(id, call)
      order.push(call)
      continue
    }
    if (e.type !== 'tool/result') continue
    const message = d['message'] as Record<string, unknown> | undefined
    const source = message?.['source'] as Record<string, unknown> | undefined
    const call = byId.get(String(source?.['callId']))
    if (call === undefined) continue
    const error = d['error'] as { name?: string; code?: string } | null | undefined
    if (error != null) call.error = error
    for (const part of (message?.['content'] ?? []) as Record<string, unknown>[]) {
      if (typeof part['isError'] === 'boolean') call.isError = part['isError']
      for (const inner of (part['content'] ?? []) as Record<string, unknown>[]) {
        if (typeof inner['text'] === 'string') call.text += inner['text']
      }
    }
  }
  return order
}

/**
 * The unreadable-arguments caveat for a criterion's detail line.
 * @param calls The calls the criterion considered.
 * @returns A note naming how many had unparsable arguments, or the empty string.
 */
function unparsedNote(calls: Call[]): string {
  const n = calls.filter(c => c.argsUnparsed === true).length
  return n === 0 ? '' : ` (${n} with UNPARSABLE arguments — target unknown, not absent)`
}

/** Whether `target` resolves outside the workspace root, which is what makes a write a sandbox test. */
function outsideWorkspace(target: string): boolean {
  if (!isAbsolute(target)) return false
  const rel = relative(process.cwd(), resolve(target))
  return rel.startsWith('..')
}

/** Events named `approval/decided`, in order, with their outcomes. */
function approvalOutcomes(events: Event[]): string[] {
  return events
    .filter(e => e.type === 'approval/decided')
    .map(e => String((e.data ?? {})['outcome']))
}

/** The turn outcomes the log closed, in order. */
function turnOutcomes(events: Event[]): string[] {
  return events
    .filter(e => e.type === 'turn/end')
    .map(e => String(((e.data ?? {})['reason'] as { kind?: string } | undefined)?.kind))
}

/**
 * B1.4 — an out-of-workspace write is attempted and the fence refuses it.
 * @param events The decoded log.
 * @returns The criteria, in report order.
 */
function checkB14(events: Event[]): Check[] {
  const writes = toolCalls(events).filter(c => c.name === 'write')
  const outside = writes.filter(c => outsideWorkspace(String(c.args['file_path'] ?? '')))
  const denied = outside.filter(c => c.error?.code === 'FS_SANDBOX_DENIED')
  const targets = outside.map(c => String(c.args['file_path']))
  const created = targets.filter(t => existsSync(t))
  const outcomes = approvalOutcomes(events)
  const turns = turnOutcomes(events)
  return [
    {
      name: 'write was actually called outside the workspace',
      pass: outside.length > 0,
      detail: outside.length > 0
        ? `${outside.length} call(s): ${targets.join(', ')}`
        : `no out-of-workspace write call — ${writes.length} write call(s) total`
          + `${unparsedNote(writes)}. A model that only DECLINED produces this, and it is not a sandbox test`,
    },
    {
      name: 'the fence returned FS_SANDBOX_DENIED',
      pass: outside.length > 0 && denied.length === outside.length,
      detail: outside.length === 0
        ? 'no call to judge'
        : `${denied.length}/${outside.length} denied; codes: ${outside.map(c => c.error?.code ?? 'none').join(', ')}`,
    },
    {
      name: 'no approval was granted',
      pass: !outcomes.includes('allowed-once'),
      detail: outcomes.length === 0 ? 'no approval/decided events' : `outcomes: ${outcomes.join(', ')}`,
    },
    {
      name: 'no file was created',
      pass: created.length === 0,
      detail: created.length === 0 ? `absent: ${targets.join(', ') || '(no target)'}` : `EXISTS: ${created.join(', ')}`,
    },
    {
      name: 'the turn completed rather than aborting',
      pass: turns.includes('completed'),
      detail: `turn/end: ${turns.join(', ') || 'none'}`,
    },
  ]
}

/**
 * The approval decision recorded for one tool call, paired by the ask's `callId`.
 * B3.1 and B3.2 run in the same conversation as B4, so a whole-log outcome list
 * cannot say which decision belongs to which write.
 * @param events The decoded log.
 * @param callId The tool call whose decision is wanted.
 * @returns The asked/decided pair's outcome, or undefined when the call raised no prompt.
 */
function decisionFor(events: Event[], callId: string): string | undefined {
  const ask = events.find(e => e.type === 'approval/asked' && String((e.data ?? {})['callId']) === callId)
  if (ask === undefined) return undefined
  const id = String((ask.data ?? {})['id'])
  const decided = events.find(e => e.type === 'approval/decided' && String((e.data ?? {})['id']) === id)
  return decided === undefined ? undefined : String((decided.data ?? {})['outcome'])
}

/**
 * B3.1 / B3.2 — an approval prompt is raised for one specific write and its
 * outcome is honoured.
 * @param events The decoded log.
 * @param expect Whether the case allowed (`allowed-once`) or denied (`rejected`) the write.
 * @param target The case's own absolute path, which is what separates it from the other B3 case in the same conversation.
 * @returns The criteria, in report order.
 */
function checkApproval(events: Event[], expect: 'allowed-once' | 'rejected', target: string): Check[] {
  const writes = toolCalls(events).filter(c => c.name === 'write')
  const matching = writes.filter(c => String(c.args['file_path'] ?? '') === target)
  const call = matching.at(-1)
  const outcome = call === undefined ? undefined : decisionFor(events, call.callId)
  const exists = existsSync(target)
  const allowed = expect === 'allowed-once'
  // Scoped to the target write's own turn: the other B3 case and B4 share this
  // conversation, so their legitimate out-of-workspace writes are not retries.
  const elsewhere = call === undefined ? [] : writes.filter(c => {
    const path = String(c.args['file_path'] ?? '')
    return c.turn === call.turn && path !== target && outsideWorkspace(path)
  })
  return [
    {
      name: `a write to ${target} was called`,
      pass: call !== undefined,
      detail: call === undefined
        ? `no write to that path — ${writes.length} write call(s) in this log${unparsedNote(writes)}`
        : `${matching.length} call(s), last at step ${call.step}`,
    },
    {
      name: 'it raised an approval prompt',
      pass: outcome !== undefined,
      detail: outcome === undefined
        ? 'no approval/asked carries this callId — the write either never ran or bypassed the prompt'
        : `asked, and decided`,
    },
    {
      name: `the decision recorded for it is ${expect}`,
      pass: outcome === expect,
      detail: `outcome: ${outcome ?? 'none'}`,
    },
    {
      // A rejected escalation reports `isError: true` with `error: null` — the
      // reason exists only as model-visible prose, unlike the fence's own
      // structured `FS_SANDBOX_DENIED`. Asserting a structured error here fails
      // a correct denial.
      name: allowed ? 'the write then succeeded' : 'the write was refused',
      pass: call !== undefined && (allowed
        ? call.isError !== true && call.error === undefined
        : call.isError === true),
      detail: call === undefined
        ? 'no call to judge'
        : `isError: ${String(call.isError)}, error: ${JSON.stringify(call.error ?? null)}, text: ${call.text.slice(0, 120)}`,
    },
    {
      name: allowed ? 'the file exists' : 'no file was created',
      pass: exists === allowed,
      detail: `${target}: ${exists ? 'exists' : 'absent'}`,
    },
    {
      name: 'nothing landed at a substituted out-of-workspace path',
      pass: elsewhere.length === 0,
      detail: elsewhere.length === 0
        ? 'none'
        : elsewhere.map(c => `${String(c.args['file_path'])} (err ${JSON.stringify(c.error ?? null)})`).join(', '),
    },
  ]
}

/**
 * B4.1 — a manual compaction replaced real history and reported no error.
 * @param events The decoded log.
 * @returns The criteria, in report order.
 */
function checkB41(events: Event[]): Check[] {
  const starts = events.filter(e => e.type === 'compaction/start')
  const summaries = events.filter(e => e.type === 'compaction/summary')
  const ends = events.filter(e => e.type === 'compaction/end')
  const failed = ends.filter(e => (e.data ?? {})['error'] !== undefined)
  const last = summaries.at(-1)
  const d = last?.data ?? {}
  const shadowedSeqs = Array.isArray(d['shadowedSeqs']) ? (d['shadowedSeqs'] as unknown[]) : []
  const shadowedTokens = Number(d['shadowedTokenCount'] ?? 0)
  const summaryBlocks = Array.isArray(d['summary']) ? (d['summary'] as unknown[]) : []
  const expectedProvider = process.env['EXPECT_SUMMARY_PROVIDER'] ?? 'local-qwen-off'
  // The replacement `user/message` MUST be appended synchronously right after
  // the metering event (the shadow-price protocol in dsh-compaction/types).
  const after = last === undefined ? undefined : events[events.indexOf(last) + 1]
  const truncated = ends
    .map(e => String((e.data ?? {})['error'] ?? ''))
    .filter(text => text.includes('summarization truncated at the token cap'))
  return [
    {
      name: 'a compaction ran',
      pass: starts.length > 0 && ends.length > 0,
      detail: `start=${starts.length} summary=${summaries.length} end=${ends.length}`,
    },
    {
      name: 'it replaced real history',
      pass: shadowedSeqs.length > 0 && shadowedTokens > 0,
      detail: last === undefined
        ? 'no compaction/summary — nothing was replaced, whatever /compact reported'
        : `shadowedSeqs=${shadowedSeqs.length} shadowedTokenCount=${shadowedTokens} range=${JSON.stringify(d['shadowedRange'])}`,
    },
    {
      name: 'the summary carries content',
      pass: summaryBlocks.length > 0,
      detail: `${summaryBlocks.length} content block(s)`,
    },
    {
      name: 'the replacement user/message follows the summary',
      pass: after?.type === 'user/message',
      detail: `next event: ${after?.type ?? 'none'}`,
    },
    {
      name: `the summarizer ran on ${expectedProvider}`,
      pass: String(d['provider'] ?? '') === expectedProvider,
      detail: `provider=${String(d['provider'] ?? 'none')} model=${String(d['model'] ?? 'none')} maxTokens=${String(d['maxTokens'] ?? 'none')}`,
    },
    {
      name: 'compaction/end reports no error',
      pass: ends.length > 0 && failed.length === 0,
      detail: failed.length === 0 ? 'clean' : failed.map(e => String((e.data ?? {})['error'])).join(' | '),
    },
    {
      name: 'no token-cap truncation',
      pass: truncated.length === 0,
      detail: truncated.length === 0 ? 'none' : truncated.join(' | '),
    },
  ]
}

/**
 * The criteria per case. The B3 targets are the paths [UAT.md](../UAT.md)
 * names, which is what identifies one case inside a shared conversation; a
 * third argument overrides them for a re-run that used a different path.
 */
const CASES: Record<string, (events: Event[], target: string) => Check[]> = {
  'B1.4': checkB14,
  'B3.1': (events, target) => checkApproval(events, 'allowed-once', target),
  'B3.2': (events, target) => checkApproval(events, 'rejected', target),
  'B4.1': checkB41,
}

/** The path each approval case writes to, absent an override. */
const CASE_TARGETS: Record<string, string> = {
  'B3.1': '/home/andrea/uat-b31.txt',
  'B3.2': '/home/andrea/uat-b32.txt',
}

const [caseId, file, targetArg] = process.argv.slice(2)
if (caseId === undefined || file === undefined) {
  process.stderr.write(`usage: check-case.mts <${Object.keys(CASES).join('|')}> <decoded.jsonl> [target-path]\n`)
  process.exit(2)
}
const check = CASES[caseId]
if (check === undefined) {
  process.stderr.write(`check-case: no log-level criteria for ${caseId} (have ${Object.keys(CASES).join(', ')})\n`)
  process.exit(2)
}

const events = readEvents(file)
const checks = check(events, targetArg ?? CASE_TARGETS[caseId] ?? '')
const passed = checks.filter(c => c.pass).length
for (const c of checks) process.stdout.write(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}\n`)
process.stdout.write(`\n${caseId}: ${passed === checks.length ? 'PASS' : 'FAIL'} (${passed}/${checks.length} criteria)\n`)
process.exit(passed === checks.length ? 0 : 1)
