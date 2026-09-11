import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { gradeRewardEnvironment, resetRewardEnvironment } from '../src/reward.ts'

it('resets repeated rollouts and rejects a correct claim with wrong final state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gh-reward-'))
  try {
    const a = await resetRewardEnvironment(root, { 'input.json': '{"amount":42}\n' })
    await writeFile(path.join(a.directory, 'answer.json'), '{"total":41}')
    expect((await gradeRewardEnvironment(a, { total: 42 })).reward).toBe(0)
    const b = await resetRewardEnvironment(root, { 'input.json': '{"amount":42}\n' })
    expect(b.inputHashes).toEqual(a.inputHashes)
    expect(b.directory).not.toBe(a.directory)
    expect((await gradeRewardEnvironment(b, { total: 42 })).outputExists).toBe(false)
    await writeFile(path.join(b.directory, 'answer.json'), '{"total":42}')
    expect((await gradeRewardEnvironment(b, { total: 42 })).reward).toBe(1)
    await writeFile(path.join(b.directory, 'input.json'), 'changed')
    expect((await gradeRewardEnvironment(b, { total: 42 })).reward).toBe(0)
    await expect(resetRewardEnvironment(root, { '../escape': 'x' })).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
