import { mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import { fixture } from './fixture.ts'
import { readArtifactSnapshot } from '../src/snapshot.ts'
import { checkpoint } from '../src/checkpoint.ts'
import { gradeWorkspace, inventoryWorkspace } from '../src/reward.ts'

it('reads live and persisted seeded children without modifying source identities or stored bytes', async () => {
  const parent = fixture('seed-parent')
  const header = { ...parent.session, id: SessionId('seed-child'), parentSession: parent.session.id, isSeeded: true }
  const inherited = SessionLogOffset(parent.events.length)
  const child = Session.create(header.id, structuredClone(parent.events), header, inherited)
  child.append('turn/start', { turn: 2 })
  child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const events = structuredClone([...child.snapshotEvents()])
  const stored = JSON.stringify(events)
  let closed = 0
  const persistence = { open: async () => ({ header, inheritedEventCount: inherited,
    read: async () => ({ events: structuredClone(events), eventState: 'detached' }), close: async () => { closed++ } }) }
  for (const live of [child, undefined]) {
    // This test supplies only the two public services consumed by the reader.
    const ctx = { sessions: { get: () => live }, sessionPersistence: persistence } as unknown as Context
    const snapshot = await readArtifactSnapshot(ctx, header.id)
    expect(snapshot.inheritedEventCount).toBe(inherited)
    expect(snapshot.events).toEqual(live ? live.snapshotEvents() : events)
    expect(JSON.stringify(events)).toBe(stored)
    expect(snapshot.reconstruction.repairEventSeqs).toEqual([])
  }
  expect(closed).toBe(1)
})

it('records cold interruption repairs without persisting synthetic closers', async () => {
  const snapshot = fixture(), events = snapshot.events.slice(0, 3), original = JSON.stringify(events)
  const ctx = { sessions: { get: () => undefined }, sessionPersistence: { open: async () => ({ header: snapshot.session, inheritedEventCount: 0,
    read: async () => ({ events }), close: async () => {} }) } } as unknown as Context
  const read = await readArtifactSnapshot(ctx, snapshot.session.id)
  expect(read.reconstruction.storedEventCount).toBe(3)
  expect(read.reconstruction.repairEventSeqs.length).toBeGreaterThan(0)
  expect(read.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'interrupted' } } })
  expect(JSON.stringify(events)).toBe(original)
})

it('resumes completed work, invalidates every changed input, and preserves rejected stages', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gh-checkpoint-'))
  try {
    let calls = 0
    const file = path.join(root, 'result.json'), identity = { source: 'a', task: 'b', grader: 'c', configuration: 'd' }
    const work = async () => ++calls
    expect((await checkpoint(file, identity, work)).result).toBe(1)
    expect((await checkpoint(file, identity, work)).result).toBe(1)
    for (const key of Object.keys(identity)) await checkpoint(file, { ...identity, [key]: 'changed' }, work)
    expect(calls).toBe(5)
    const failure = await checkpoint(path.join(root, 'export.json'), identity, async () => { throw Error('offline') })
    expect(failure.rejection).toContain('offline')
    expect(failure.retryable).toBe(true)
    expect((await checkpoint(path.join(root, 'export.json'), identity, async () => 'recovered')).result).toBe('recovered')
    expect(JSON.parse(await readFile(file, 'utf8')).result).toBe(5)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects tampering, unexpected files, deletions, symlinks and incorrect JSON outputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gh-inventory-'))
  try {
    await writeFile(path.join(root, 'input.json'), '{"value":42}')
    const before = await inventoryWorkspace(root)
    await writeFile(path.join(root, 'answer.json'), '{"answer":42}')
    const grade = () => gradeWorkspace(root, before, { 'answer.json': { answer: 42 } })
    expect((await grade()).status).toBe('pass')
    await writeFile(path.join(root, 'extra.txt'), 'forbidden')
    expect((await grade()).status).toBe('fail')
    await rm(path.join(root, 'extra.txt'))
    await writeFile(path.join(root, 'input.json'), '{}')
    expect((await grade()).status).toBe('fail')
    await rm(path.join(root, 'input.json'))
    expect((await grade()).status).toBe('fail')
    await symlink('answer.json', path.join(root, 'input.json'))
    expect((await grade()).failures).toContain('unsupported entry: input.json')
  } finally { await rm(root, { recursive: true, force: true }) }
})
