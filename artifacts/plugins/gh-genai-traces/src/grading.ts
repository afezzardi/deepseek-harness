/** Typed deterministic outcome grading shared by campaigns and reward experiments. */
import path from 'node:path'
import { z } from 'zod'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import { digest, type Grade } from './curation.ts'
import { gradeWorkspace, type inventoryWorkspace } from './reward.ts'
import { gradeAgents } from './agent-grading.ts'

/** Shared grade/checkpoint semantic version; bump when any grading rule changes. */
export const GRADER_VERSION = 'deterministic-v6'

/** Bind reusable grades to the grading implementation and every canonical source.
 * @param snapshot - independently graded parent source.
 * @param children - child sources consulted by the task grader.
 * @param implementation - digest of the explicit build source inventory.
 * @returns checkpoint evidence identity, independent of child read order.
 */
export function gradingIdentity(snapshot: SessionLogSnapshot, children: readonly SessionLogSnapshot[], implementation: string) {
  return { version: GRADER_VERSION, implementation, source: digest(snapshot),
    children: children.map(child => ({ session: child.session.id, source: digest(child) })).sort((a, b) => a.session.localeCompare(b.session)) }
}

/** Task-owned evidence needed before a filesystem trajectory can pass. */
export interface TaskEvidence {
  family: string
  expected: unknown
  workspace: string
  cwd: string
  before: Awaited<ReturnType<typeof inventoryWorkspace>> | null
  outputs: Record<string, unknown>
  required: Grade['required']
  allowedTools: string[]
  requiredReads: string[]
  requiredEvents?: Record<string, number>
  requiredCalls?: Record<string, number>
  forbiddenEvents?: string[]
  recovery: boolean
  execution: Grade['execution']
}
const fileArgs = z.object({ file_path: z.string().min(1) })
const fileSchemas = {
  read: fileArgs.extend({ offset: z.number().int().positive().optional(), limit: z.number().int().positive().optional() }).strict(),
  write: fileArgs.extend({ content: z.string() }).strict(),
  edit: fileArgs.extend({ old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() }).strict(),
}

/** Grade answer, typed tool decisions, recorded outcomes, and observed workspace separately.
 * @param snapshot - canonical validated session.
 * @param task - frozen task specification and pre-inference inventory.
 * @param children - independently reconstructed child sources used by agent graders.
 * @returns evidence-bearing observations; missing observations remain unknown.
 */
export async function gradeTask(snapshot: SessionLogSnapshot, task: TaskEvidence, children?: readonly SessionLogSnapshot[]): Promise<Grade> {
  const observation = (status: Grade['observations']['syntax']['status'], evidence: string[]) => ({ status, evidence })
  const target = snapshot.events.findLast(event => event.type === 'assistant/message')
  const answer = target?.type === 'assistant/message' ? target.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') : ''
  let syntax = false, semantics = false
  try { const parsed: unknown = JSON.parse(answer); syntax = true; semantics = digest(parsed) === digest(task.expected) } catch { /* Invalid JSON is a syntax failure. */ }
  const failures: string[] = [], unknown: string[] = [], reads = new Map<string, number>(), writes = new Map<string, number>()
  const results = new Map(snapshot.events.filter(e => e.type === 'tool/result').map(e => [e.data.message.content[0].toolCallId, e]))
  if (results.size !== snapshot.events.filter(e => e.type === 'tool/result').length) failures.push('duplicate result identity')
  const calls = snapshot.events.filter(e => e.type === 'tool/call')
  const mutations = new Map<string, number>()
  for (const call of calls) {
    if (!['write', 'edit'].includes(call.data.name)) continue
    try {
      const args = fileArgs.passthrough().parse(JSON.parse(call.data.arguments))
      const absolute = path.resolve(task.cwd, args.file_path)
      mutations.set(absolute, (mutations.get(absolute) ?? 0) + 1)
    } catch { /* Malformed mutation arguments are rejected by the per-call grader. */ }
  }
  let agents: ReturnType<typeof gradeAgents> | undefined
  if (['delegation', 'workflow'].includes(task.family)) {
    try { agents = gradeAgents(snapshot, task, children) }
    catch { agents = { status: 'fail', evidence: ['malformed recorded agent arguments'] } }
  }
  const decisions: NonNullable<Grade['decisions']> = []
  if (new Set(calls.map(e => e.data.callId)).size !== calls.length) failures.push('duplicate call identity')
  for (const id of results.keys()) if (!calls.some(e => e.data.callId === id)) failures.push('orphan result identity')
  let recoveryError: number | undefined
  for (const event of snapshot.events) {
    if (event.type !== 'tool/call') continue
    const failureOffset = failures.length, unknownOffset = unknown.length
    if (!task.allowedTools.includes(event.data.name)) failures.push(`undeclared tool at ${event.seq}: ${event.data.name}`)
    try {
      const args: unknown = JSON.parse(event.data.arguments)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('arguments must be an object')
      const result = results.get(event.data.callId)
      if (!result) failures.push(`missing result for ${event.seq}`)
      else if (result.seq <= event.seq) failures.push(`result precedes call at ${event.seq}`)
      if (['read', 'write', 'edit'].includes(event.data.name)) {
        const parsed = fileSchemas[event.data.name as keyof typeof fileSchemas].parse(args), absolute = path.resolve(task.cwd, parsed.file_path), relative = path.relative(task.workspace, absolute)
        if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) failures.push(`tool path outside observed workspace at ${event.seq}`)
        if (event.data.name === 'read' && result && !result.data.message.content[0].isError) reads.set(relative, event.seq)
        if (event.data.name !== 'read' && !Object.hasOwn(task.outputs, relative)) failures.push(`forbidden write at ${event.seq}`)
        if (event.data.name === 'write' && 'content' in parsed && Object.hasOwn(task.outputs, relative)) {
          let content: unknown
          try { content = JSON.parse(parsed.content) } catch { failures.push(`write content is not JSON at ${event.seq}`) }
          if (content !== undefined && digest(content) !== digest(task.outputs[relative])) failures.push(`write content differs from expected output at ${event.seq}`)
        }
        if (event.data.name === 'edit' && mutations.get(absolute) !== 1) unknown.push(`edit content is unverified across multiple mutations of ${relative} at ${event.seq}`)
        if (event.data.name !== 'read' && result && !result.data.message.content[0].isError) writes.set(relative, result.seq)
        if (result?.data.error?.code === 'FS_NOT_FOUND' && task.recovery && event === calls[0] && event.data.name === 'read' && relative === 'missing.json') recoveryError = result.seq
        else if (result?.data.message.content[0].isError) failures.push(`tool error at ${result.seq}`)
      } else if (agents && ['subagent', 'job_output', 'workflow'].includes(event.data.name)) {
        if (result?.data.message.content[0].isError) failures.push(`tool error at ${result.seq}`)
      } else unknown.push(`no task-specific argument/result grader for ${event.data.name}`)
    } catch { failures.push(`malformed tool arguments at ${event.seq}`) }
    const agentDecision = agents && ['subagent', 'job_output', 'workflow'].includes(event.data.name) ? agents : undefined
    const evidence = [...failures.slice(failureOffset), ...unknown.slice(unknownOffset), ...agentDecision && agentDecision.status !== 'pass' ? agentDecision.evidence : []]
    decisions.push({ call: event.seq, status: failures.length > failureOffset || agentDecision?.status === 'fail' ? 'fail' : unknown.length > unknownOffset || agentDecision?.status === 'unknown' ? 'unknown' : 'pass',
      evidence: evidence.length ? evidence : [`typed ${event.data.name} decision and paired result at ${results.get(event.data.callId)?.seq}`] })
  }
  for (const required of task.requiredReads) if (!reads.has(required)) failures.push(`missing successful read: ${required}`)
  if (task.recovery && (recoveryError === undefined || !task.requiredReads.every(name => (reads.get(name) ?? -1) > recoveryError!))) failures.push('missing ordered recovery from missing.json to successful required reads')
  for (const name of Object.keys(task.outputs)) {
    if (!writes.has(name) || (reads.get(name) ?? -1) <= writes.get(name)!) failures.push(`missing successful write and subsequent read: ${name}`)
  }
  for (const [type, minimum] of Object.entries(task.requiredEvents ?? {})) {
    if (snapshot.events.filter(event => event.type === type).length < minimum) failures.push(`missing required event: ${type}`)
  }
  for (const [name, minimum] of Object.entries(task.requiredCalls ?? {})) {
    if (calls.filter(event => event.data.name === name).length < minimum) failures.push(`missing required call: ${name}`)
  }
  for (const type of task.forbiddenEvents ?? ['approval/asked', 'approval/decided']) if (snapshot.events.some(event => event.type === type)) failures.push(`forbidden event: ${type}`)
  if (agents?.status === 'fail') failures.push(...agents.evidence)
  if (agents?.status === 'unknown') unknown.push(...agents.evidence)
  const environment = task.before ? await gradeWorkspace(task.workspace, task.before, task.outputs) : null
  return { version: GRADER_VERSION, required: task.required, execution: task.execution, decisions,
    observations: { syntax: observation(syntax ? 'pass' : 'fail', [`answer event ${target?.seq ?? 'missing'}`]),
      semantics: observation(semantics ? 'pass' : 'fail', [`expected sha256 ${digest(task.expected)}`]),
      tools: observation(failures.length ? 'fail' : unknown.length ? 'unknown' : 'pass', failures.length ? failures : unknown.length ? unknown : ['typed arguments and recorded results satisfy task requirements']),
      environment: observation(environment?.status ?? 'unknown', environment ? [JSON.stringify(environment)] : ['pre-inference workspace inventory missing']),
    } }
}
