/** Admission controls with independent filesystem and canonical tool evidence. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { gradeTask, GRADER_VERSION, type TaskEvidence } from '../src/grading.ts'
import { inventoryWorkspace } from '../src/reward.ts'
import { fixture } from './fixture.ts'

it('requires typed read arguments and independent evidence even when the final answer is correct', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'gh-grade-'))
  try {
    await writeFile(path.join(workspace, 'input.json'), '{"value":42}')
    const task: TaskEvidence = { family: 'read', expected: { value: 42 }, workspace, cwd: workspace,
      before: await inventoryWorkspace(workspace), outputs: {}, allowedTools: ['read'], requiredReads: ['input.json'],
      required: ['syntax', 'semantics', 'tools', 'environment'], recovery: false, execution: { exitCode: 0, timedOut: false } }
    const source = structuredClone(fixture())
    const call = source.events.find(e => e.type === 'tool/call')!
    if (call.type !== 'tool/call') throw Error('missing fixture call')
    call.data.arguments = '{"file_path":"input.json"}'
    const answer = source.events.findLast(e => e.type === 'assistant/message')!
    if (answer.type !== 'assistant/message') throw Error('missing fixture answer')
    answer.data.message = { ...answer.data.message, content: [{ type: 'text', text: '{"value":42}' }] }
    expect((await gradeTask(source, task)).observations.tools.status).toBe('pass')
    for (const args of ['{"file_path":"input.json","limit":"all"}', '{"file_path":17}', 'null', '{']) {
      call.data.arguments = args
      const grade = await gradeTask(source, task)
      expect(grade.observations.semantics.status).toBe('pass')
      expect(grade.observations.tools.status).toBe('fail')
    }
    call.data.arguments = '{"file_path":"input.json"}'
    expect((await gradeTask(source, { ...task, before: null })).observations.environment.status).toBe('unknown')
    await writeFile(path.join(workspace, 'input.json'), '{}')
    expect((await gradeTask(source, task)).observations.environment.status).toBe('fail')
    call.data.name = 'write'; call.data.arguments = '{"file_path":"input.json","content":"{}"}'
    expect((await gradeTask(source, { ...task, allowedTools: ['write'] })).observations.tools.status).toBe('fail')
    call.data.name = 'subagent'; call.data.arguments = '{}'
    expect((await gradeTask(source, { ...task, allowedTools: ['subagent'], requiredReads: [] })).observations.tools.status).toBe('unknown')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

it('rejects an incorrect write and leaves repeated edits unknown despite a correct final state', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'gh-mutation-grade-'))
  try {
    await writeFile(path.join(workspace, 'config.json'), '{"enabled":false}')
    const before = await inventoryWorkspace(workspace)
    await writeFile(path.join(workspace, 'config.json'), '{"enabled":true}')
    const task: TaskEvidence = { family: 'scoped-edit', expected: { enabled: true }, workspace, cwd: workspace, before,
      outputs: { 'config.json': { enabled: true } }, allowedTools: ['write', 'edit', 'read'], requiredReads: ['config.json'],
      required: ['syntax', 'semantics', 'tools', 'environment'], recovery: false, execution: { exitCode: 0, timedOut: false } }
    const makeSource = (name: string, argumentsList: string[]) => {
      const source = structuredClone(fixture())
      const call = source.events.find(e => e.type === 'tool/call')!, result = source.events.find(e => e.type === 'tool/result')!
      const pairs = [...argumentsList.map(arguments_ => ({ name, arguments_ })), { name: 'read', arguments_: '{"file_path":"config.json"}' }]
      const events = pairs.flatMap((entry, i) => {
        const c = structuredClone(call), r = structuredClone(result), id = ToolCallId('mutation-' + i)
        c.data = { ...c.data, name: entry.name, arguments: entry.arguments_, callId: id }
        r.data.message.content[0].toolCallId = id
        return [c, r]
      })
      source.events.splice(call.seq, 2, ...events)
      source.events = source.events.map((event, seq) => ({ ...event, seq: SessionSeq(seq) }))
      const answer = source.events.findLast(e => e.type === 'assistant/message')!
      answer.data.message = { ...answer.data.message, content: [{ type: 'text', text: '{"enabled":true}' }] }
      return source
    }
    const wrongWrite = JSON.stringify({ file_path: 'config.json', content: '{"enabled":false}' })
    const correctWrite = JSON.stringify({ file_path: 'config.json', content: '{"enabled":true}' })
    const writes = await gradeTask(makeSource('write', [wrongWrite, correctWrite]), task)
    expect(writes.version).toBe(GRADER_VERSION)
    expect(writes.observations.environment.status).toBe('pass')
    expect(writes.observations.semantics.status).toBe('pass')
    expect(writes.decisions?.map(d => d.status)).toEqual(['fail', 'pass', 'pass'])
    const edit = JSON.stringify({ file_path: 'config.json', old_string: 'false', new_string: 'true' })
    const edits = await gradeTask(makeSource('edit', [edit, edit]), task)
    expect(edits.observations.environment.status).toBe('pass')
    expect(edits.decisions?.map(d => d.status)).toEqual(['unknown', 'unknown', 'pass'])
    expect((await gradeTask(makeSource('edit', [edit]), task)).decisions?.[0]?.status).toBe('pass')
    expect((await gradeTask(makeSource('write', [correctWrite]), task)).observations.tools.status).toBe('pass')
    const nonJson = await gradeTask(makeSource('write', [JSON.stringify({ file_path: 'config.json', content: 'not JSON' })]), task)
    expect(nonJson.decisions?.[0]?.evidence.join(' ')).toContain('write content is not JSON')
    expect(nonJson.decisions?.[0]?.evidence.join(' ')).not.toContain('malformed tool arguments')
    const forbidden = await gradeTask(makeSource('write', [correctWrite]), { ...task, outputs: {} })
    expect(forbidden.decisions?.[0]?.evidence.join(' ')).toContain('forbidden write')
    expect(forbidden.decisions?.[0]?.evidence.join(' ')).not.toContain('malformed tool arguments')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
