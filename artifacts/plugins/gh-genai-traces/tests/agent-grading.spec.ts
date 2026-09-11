/** Agent decisions require owned child observations even with a correct parent answer. */
import { expect, it } from 'vitest'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { ToolWorkflowRunStartData } from '@deepseek-ai/dsh-tool-workflow/types'
import { gradeAgents } from '../src/agent-grading.ts'
import { fixture } from './fixture.ts'

function child(id: string): SessionLogSnapshot {
  const source = structuredClone(fixture(id))
  source.session = { ...source.session, parentSession: SessionId('parent') }
  const call = source.events.find(e => e.type === 'tool/call')!
  call.data.arguments = '{"file_path":"input.json"}'
  const answer = source.events.findLast(e => e.type === 'assistant/message')!
  answer.data.message = { ...answer.data.message, content: [{ type: 'text', text: 'CASE-31 ' + id }] }
  return source
}

it('grades member-order workflow evidence and rejects missing, reordered and writing children', () => {
  const source = structuredClone(fixture('parent')), children = [child('a'), child('b'), child('c')]
  const call = source.events.find(e => e.type === 'tool/call')!
  call.data.name = 'workflow'; call.data.arguments = JSON.stringify({ script: 'return await parallel([])', meta: { name: 'read', description: 'read three inputs' } })
  const result = source.events.find(e => e.type === 'tool/result')!
  result.data.message.content[0].content = [{ type: 'text', text: 'workflow "read" completed (3 agents).\nReturn value:\n["CASE-31 a", "CASE-31 b", "CASE-31 c"]' }]
  const session = Session.create(source.session.id, source.events.slice(0, result.seq), source.session)
  const runId = 'run' as ToolWorkflowRunStartData['runId']
  session.append('tool-workflow/run-start', { runId, name: 'read' })
  for (const [index, member] of children.entries()) {
    session.append('tool-workflow/agent-start', { runId, seq: index + 1, label: member.session.id, childId: member.session.id })
    session.append('tool-workflow/agent-end', { runId, seq: index + 1, outcome: 'completed' })
  }
  session.append('tool-workflow/run-end', { runId, stopReason: 'completed' })
  for (const event of source.events.slice(result.seq)) {
    if (event.type === 'tool/result') session.append(event.type, event.data, { surfaceOp: event.surfaceOp! })
    else if (event.type === 'assistant/message') session.append(event.type, event.data, { surfaceOp: event.surfaceOp! })
    else if (event.type === 'step/start' || event.type === 'step/end' || event.type === 'turn/end') session.append(event.type, event.data)
    else throw Error('Unexpected workflow fixture suffix')
  }
  source.events = structuredClone([...session.snapshotEvents()])
  const task = { family: 'workflow', workspace: '/fixture', cwd: '/fixture', expected: { code: 'CASE-31' }, requiredEvents: { 'tool-workflow/agent-start': 3 } }
  expect(gradeAgents(source, task, children).status).toBe('pass')
  expect(gradeAgents(source, { ...task, requiredEvents: {} }, children).status).toBe('unknown')
  const late = structuredClone(source)
  const lateResult = late.events.find(e => e.type === 'tool/result')!
  lateResult.seq = call.seq
  expect(gradeAgents(late, task, children).evidence).toContain('workflow lifecycle does not belong to its call and result')
  expect(gradeAgents(source, task, children.slice(1)).status).not.toBe('pass')
  const write = children[0]!.events.find(e => e.type === 'tool/call')!
  write.data.name = 'write'
  expect(gradeAgents(source, task, children).status).toBe('fail')
  write.data.name = 'read'
  const answer = children[0]!.events.findLast(e => e.type === 'assistant/message')!
  answer.data.message = { ...answer.data.message, content: [{ type: 'text', text: 'CASE-31 first' }] }
  expect(gradeAgents(source, task, children).evidence).toContain('workflow result does not preserve member order')
})

it('refuses a correct final answer when the configured delegation result has no requested job identity', () => {
  const source = structuredClone(fixture('parent'))
  const call = source.events.find(e => e.type === 'tool/call')!
  call.data.name = 'subagent'; call.data.arguments = JSON.stringify({ description: 'read input', prompt: 'Read input.json', run_in_background: true })
  source.events.find(e => e.type === 'tool/result')!.data.message.content[0].content = [{ type: 'text', text: 'started subagent a' }]
  const result = gradeAgents(source, { family: 'delegation', workspace: '/fixture', cwd: '/fixture', expected: { code: 'CASE-31' }, requiredCalls: { subagent: 1, job_output: 1 } }, [child('a')])
  expect(result.status).toBe('fail')
  expect(result.evidence).toContain(`background job identity missing: ${call.seq}`)
})

it('accepts background job collection and rejects foreign or unfinished jobs', () => {
  const source = structuredClone(fixture('parent')), children = [child('a'), child('b')]
  const call = source.events.find(e => e.type === 'tool/call')!, result = source.events.find(e => e.type === 'tool/result')!
  const session = Session.create(source.session.id, source.events.slice(0, call.seq), source.session)
  for (const [index, member] of children.entries()) {
    const callId = ToolCallId('start-' + index)
    session.append('tool/call', { ...call.data, callId, name: 'subagent', arguments: JSON.stringify({ description: 'read input', prompt: 'Read input.json', run_in_background: true }) })
    session.append('tool/result', { ...result.data, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'started background subagent job job-' + member.session.id }], isError: false }) }, { surfaceOp: 'append' })
  }
  for (const [index, member] of children.entries()) {
    const callId = ToolCallId('collect-' + index)
    session.append('tool/call', { ...call.data, callId, step: 2, name: 'job_output', arguments: JSON.stringify({ job_id: 'job-' + member.session.id, wait: true }) })
    session.append('tool/result', { ...result.data, step: 2, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'CASE-31 ' + member.session.id + '\n[status: completed]' }], isError: false }) }, { surfaceOp: 'append' })
  }
  source.events = structuredClone([...session.snapshotEvents()])
  const task = { family: 'delegation', workspace: '/fixture', cwd: '/fixture', expected: { code: 'CASE-31' }, requiredCalls: { subagent: 2, job_output: 2 } }
  expect(gradeAgents(source, task, children).status).toBe('pass')
  expect(gradeAgents(source, { ...task, requiredCalls: {} }, children).status).toBe('unknown')
  const collect = source.events.find(e => e.type === 'tool/call' && e.data.name === 'job_output')!
  if (collect.type !== 'tool/call') throw Error('missing collection')
  const args = collect.data.arguments
  collect.data.arguments = '{"job_id":"foreign","wait":true}'
  expect(gradeAgents(source, task, children).status).toBe('fail')
  collect.data.arguments = args
  const output = source.events.findLast(e => e.type === 'tool/result')!
  output.data.message.content[0].content = [{ type: 'text', text: 'CASE-31 b\n[status: running]' }]
  expect(gradeAgents(source, task, children).status).toBe('fail')
})
