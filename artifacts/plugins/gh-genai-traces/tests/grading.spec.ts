/** Admission controls with independent filesystem and canonical tool evidence. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { gradeTask, type TaskEvidence } from '../src/grading.ts'
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
