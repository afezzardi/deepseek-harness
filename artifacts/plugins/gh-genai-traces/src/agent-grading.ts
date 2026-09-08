/** Task-specific delegation and workflow observations from durable child sessions. */
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import path from 'node:path'
import { z } from 'zod'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import { digest } from './curation.ts'

const subagent = z.object({ description: z.string().min(1), prompt: z.string().min(1), run_in_background: z.literal(true),
  provider: z.string().optional(), model: z.string().optional(), reasoning_effort: z.literal('medium').optional() }).strict()
const job = z.object({ job_id: z.string().min(1), wait: z.boolean().optional(), timeout_ms: z.number().positive().optional() }).strict()
const workflow = z.object({ script: z.string().min(1), meta: z.object({ name: z.string().min(1), description: z.string().min(1) }).passthrough(), args: z.record(z.string(), z.unknown()).optional() }).strict()

function answer(snapshot: SessionLogSnapshot): string {
  const event = snapshot.events.findLast(e => e.type === 'assistant/message')
  return event?.type === 'assistant/message' ? event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') : ''
}

function childValue(snapshot: SessionLogSnapshot): unknown {
  const event = snapshot.events.findLast(e => e.type === 'tool/call' && e.data.name === 'structured_output')
  return event?.type === 'tool/call' ? JSON.parse(event.data.arguments) : answer(snapshot)
}

function hasOrderedMembers(value: unknown, expected: unknown[]): boolean {
  if (digest(value) === digest(expected)) return true
  return !!value && typeof value === 'object' && Object.values(value).some(member => hasOrderedMembers(member, expected))
}

/** Assess only the benchmark's read-only fan-out and ordered-join tasks.
 * @param snapshot - parent history.
 * @param task - frozen task family, workspace, expected code and required counts.
 * @param children - independently reconstructed owned children; omission stays unknown.
 * @returns a shared trajectory assessment that may select calls only after all required evidence passes.
 */
export function gradeAgents(snapshot: SessionLogSnapshot, task: {
  family: string; workspace: string; cwd: string; expected: unknown; requiredCalls?: Record<string, number>; requiredEvents?: Record<string, number>
}, children?: readonly SessionLogSnapshot[]): { status: 'pass' | 'fail' | 'unknown'; evidence: string[] } {
  const failures: string[] = [], missing: string[] = []
  const calls = snapshot.events.filter(e => e.type === 'tool/call')
  const results = snapshot.events.filter(e => e.type === 'tool/result')
  const text = (id: string) => results.find(e => e.data.message.content[0].toolCallId === id)?.data.message.content[0].content.filter(b => b.type === 'text').map(b => b.text).join('') ?? ''
  const owned = children?.filter(child => child.session.parentSession === snapshot.session.id)
  if (!owned) missing.push('canonical child snapshots missing')
  const expected = z.object({ code: z.string().min(1) }).safeParse(task.expected)
  if (!expected.success) missing.push('task-specific expected code missing')
  for (const child of owned ?? []) {
    const events = child.events.slice(child.inheritedEventCount)
    const end = events.findLast(e => e.type === 'turn/end')
    if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed') failures.push(`child incomplete: ${child.session.id}`)
    let read = false
    for (const event of events) {
      if (event.type === 'approval/asked' || event.type === 'approval/decided') failures.push(`child approval: ${child.session.id} at ${event.seq}`)
      if (event.type !== 'tool/call') continue
      if (event.data.name === 'structured_output') {
        const result = events.find(e => e.type === 'tool/result' && e.data.message.content[0].toolCallId === event.data.callId && e.seq > event.seq)
        if (result?.type !== 'tool/result' || result.data.message.content[0].isError) failures.push(`child structured output failed: ${child.session.id} at ${event.seq}`)
        continue
      }
      const args = z.object({ file_path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().optional() }).strict().safeParse(JSON.parse(event.data.arguments))
      if (event.data.name !== 'read' || !args.success || path.resolve(task.cwd, args.data.file_path) !== path.join(task.workspace, 'input.json')) failures.push(`child violates read-only input task: ${child.session.id} at ${event.seq}`)
      const result = events.find(e => e.type === 'tool/result' && e.data.message.content[0].toolCallId === event.data.callId && e.seq > event.seq)
      if (result?.type !== 'tool/result' || result.data.message.content[0].isError) failures.push(`child read failed: ${child.session.id} at ${event.seq}`)
      else read = true
    }
    const value = childValue(child)
    const code = typeof value === 'string' ? value : z.object({ code: z.string() }).safeParse(value).data?.code
    if (!read || expected.success && !code?.includes(expected.data.code)) failures.push(`child lacks required read or code: ${child.session.id}`)
  }
  if (task.family === 'delegation') {
    const starts = calls.filter(e => e.data.name === 'subagent'), collects = calls.filter(e => e.data.name === 'job_output')
    const count = task.requiredCalls?.subagent
    if (!count) missing.push('delegation count unspecified')
    if (count !== undefined && (starts.length !== count || owned && owned.length !== count)) failures.push('delegation child count differs')
    if (new Set(starts.map(e => `${e.data.turn}/${e.data.step}`)).size !== 1) failures.push('delegations were not launched in one concurrent batch')
    const ids = new Map<string, number>(), collected = new Set<string>()
    for (const start of starts) {
      const parsed = subagent.safeParse(JSON.parse(start.data.arguments))
      if (!parsed.success || !parsed.data.prompt.includes('input.json')) failures.push(`invalid delegation arguments: ${start.seq}`)
      const match = /^started background subagent job (\S+)$/.exec(text(start.data.callId))
      if (!match) failures.push(`background job identity missing: ${start.seq}`)
      else if (ids.has(match[1]!)) failures.push('duplicate background job identity')
      else ids.set(match[1]!, start.seq)
    }
    for (const collect of collects) {
      const parsed = job.safeParse(JSON.parse(collect.data.arguments))
      if (!parsed.success || !ids.has(parsed.data.job_id) || ids.get(parsed.data.job_id)! >= collect.seq) { failures.push(`unowned collection: ${collect.seq}`); continue }
      const output = text(collect.data.callId)
      if (/\[status: completed(?:, [^\]]*)?\]$/.test(output) && expected.success && output.includes(expected.data.code)) collected.add(parsed.data.job_id)
    }
    if (count !== undefined && collected.size !== count) failures.push('not every declared job yielded the required code')
  } else {
    const runs = snapshot.events.filter(e => e.type === 'tool-workflow/run-start')
    const start = runs[0], call = calls.find(e => e.data.name === 'workflow')
    if (runs.length !== 1 || !start || !call || calls.filter(e => e.data.name === 'workflow').length !== 1 || !workflow.safeParse(JSON.parse(call.data.arguments)).success) failures.push('expected one valid workflow')
    else {
      const result = results.find(e => e.data.message.content[0].toolCallId === call.data.callId)
      const ends = snapshot.events.filter(e => e.type === 'tool-workflow/run-end').filter(e => e.data.runId === start.data.runId)
      const end = ends[0]
      if (!result || start.seq <= call.seq || ends.length !== 1 || !end || end.seq <= start.seq || end.seq >= result.seq || end.data.stopReason !== 'completed') failures.push('workflow lifecycle does not belong to its call and result')
      const members = snapshot.events.filter(e => e.type === 'tool-workflow/agent-start').filter(e => e.data.runId === start.data.runId).sort((a, b) => a.data.seq - b.data.seq)
      const count = task.requiredEvents?.['tool-workflow/agent-start']
      if (!count) missing.push('workflow count unspecified')
      if (count !== undefined && (members.length !== count || new Set(members.map(e => e.data.childId)).size !== count || owned && owned.length !== count)) failures.push('workflow member count differs')
      for (const member of members) {
        if (member.seq <= start.seq || !end || member.seq >= end.seq) failures.push('workflow member lies outside its run')
        if (owned && !owned.some(child => child.session.id === member.data.childId)) missing.push(`workflow child absent: ${member.data.childId}`)
        const settlements = snapshot.events.filter(e => e.type === 'tool-workflow/agent-end').filter(e => e.data.runId === start.data.runId && e.data.seq === member.data.seq)
        if (settlements.length !== 1 || !settlements.some(e => e.seq > member.seq && end && e.seq < end.seq && e.data.outcome === 'completed')) failures.push(`workflow member failed: ${member.data.seq}`)
      }
      if (new Set(members.map(e => e.data.seq)).size !== members.length) failures.push('duplicate workflow member sequence')
      const returned = text(call.data.callId).split('\nReturn value:\n')[1]
      try {
        const values = owned && members.map(m => childValue(owned.find(child => child.session.id === m.data.childId)!))
        if (!values) missing.push('workflow return cannot be matched without children')
        else if (new Set(values.map(digest)).size !== values.length) missing.push('equal member values cannot establish collection order')
        else if (!returned || !hasOrderedMembers(JSON.parse(returned), values)) failures.push('workflow result does not preserve member order')
      } catch { failures.push('workflow return value cannot be matched to children') }
    }
  }
  return { status: failures.length ? 'fail' : missing.length ? 'unknown' : 'pass', evidence: [...failures, ...missing].length ? [...failures, ...missing] : ['owned read-only children, task-specific arguments, identities and collected results verified'] }
}
