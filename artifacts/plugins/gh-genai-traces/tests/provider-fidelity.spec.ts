/** Offline payload capture through the installed adapter; fetch never reaches a provider. */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { load as parse } from 'js-yaml'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { deriveEventMessage, foldRequestHeader, foldSurface, Session } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import { digest } from '../src/curation.ts'
import { atomicJson } from '../src/checkpoint.ts'

function divergence(a: unknown, b: unknown, at = '$'): string | null {
  if (digest(a ?? null) === digest(b ?? null)) return null
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return at
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const next = divergence((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`)
    if (next) return next
  }
  return at
}

function matchRecording(body: unknown, byHash: ReadonlyMap<string, readonly number[]>, used: ReadonlySet<number>): number {
  return byHash.get(digest(body))?.find(index => !used.has(index)) ?? -1
}

it('identifies a corrupted message independently of request defaults', () => {
  expect(divergence({ messages: [{ content: 'a' }] }, { messages: [{ content: 'b' }] })).toBe('$.messages.0.content')
  expect(divergence({ max_tokens: 10 }, { max_tokens: 11 })).toBe('$.max_tokens')
  const body = { messages: [{ content: 'a' }] }, index = new Map([[digest(body), [0]]])
  expect(matchRecording(body, index, new Set())).toBe(0)
  expect(matchRecording({ messages: [{ content: 'b' }] }, index, new Set())).toBe(-1)
  expect(matchRecording(body, index, new Set([0]))).toBe(-1)
})

it.skipIf(!process.env.GH_FIDELITY_MANIFEST)('reconstructs recorded payloads with corruption and unmatched-request diagnostics', async () => {
  const manifest = JSON.parse(await readFile(process.env.GH_FIDELITY_MANIFEST!, 'utf8')) as {
    snapshots: string; recordings: string[]; settings: string; output: string; recordingScope: 'complete' | 'selected-sources'
  }
  expect(['complete', 'selected-sources']).toContain(manifest.recordingScope)
  const settings = parse(await readFile(manifest.settings, 'utf8')) as { 'llm-pi-ai': { providers: Record<string, PiAiProviderProfile> } }
  const ctx = new Context()
  const runtimeFiber = await ctx.plugin(LlmRuntime)
  vi.stubEnv('GH_OFFLINE_KEY', 'offline-capture')
  const providerFiber = await ctx.plugin(LlmPiAi, { providers: Object.fromEntries(Object.entries(settings['llm-pi-ai'].providers).map(([id, profile]) => [id, { ...profile, apiKeyEnv: 'GH_OFFLINE_KEY' }])) })
  const records = (await Promise.all(manifest.recordings.map(async file => (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => ({ file, ...JSON.parse(line) } as { file: string; body?: unknown; request_sha256?: string; request_id?: string; proxy_write_error?: string }))))).flat().filter(r => r.body)
  const byHash = new Map<string, number[]>(), byMessages = new Map<string, number>()
  records.forEach((record, index) => {
    const hash = digest(record.body)
    byHash.set(hash, [...byHash.get(hash) ?? [], index])
    byMessages.set(digest((record.body as { messages?: unknown }).messages ?? null), index)
  })
  const used = new Set<number>(), rows: { status: string; [key: string]: unknown }[] = []
  let captured: string | undefined
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = init?.body ? String(init.body) : input instanceof Request ? await input.text() : undefined
    throw Error('OFFLINE_PAYLOAD_CAPTURE')
  })
  try {
    for (const file of (await readdir(manifest.snapshots)).filter(name => name.endsWith('.session.json')).sort()) {
      const snapshot = JSON.parse(await readFile(path.join(manifest.snapshots, file), 'utf8')) as SessionLogSnapshot
      Session.create(snapshot.session.id, snapshot.events, snapshot.session, snapshot.inheritedEventCount)
      for (const event of snapshot.events) {
        if (!['assistant/message', 'assistant/attempt'].includes(event.type) || event.seq < snapshot.inheritedEventCount) continue
        const prefix = snapshot.events.slice(0, event.seq), header = foldRequestHeader(prefix)
        if (!header) continue
        const messages = foldSurface(prefix).nodes.flatMap(seq => { const message = deriveEventMessage(prefix[seq]!); return message ? [message] : [] })
        captured = undefined
        let error: string | undefined
        try {
          const prepared = await ctx.llm.prepareCall(header.config)
          for await (const chunk of prepared.stream({ ...header.config, ...header.system === undefined ? {} : { system: header.system }, ...header.tools === undefined ? {} : { tools: header.tools }, messages })) void chunk
        }
        catch (caught) { error = String(caught) }
        if (!captured) { rows.push({ session: snapshot.session.id, event: event.seq, status: 'uncaptured', error }); continue }
        const body: unknown = JSON.parse(captured), reconstructedHash = createHash('sha256').update(captured).digest('hex')
        const match = matchRecording(body, byHash, used)
        if (match >= 0) used.add(match)
        const nearest = records[match >= 0 ? match : byMessages.get(digest((body as { messages?: unknown }).messages ?? null)) ?? -1]
        const corrupted = structuredClone(body) as { messages: { content: unknown }[] }
        corrupted.messages[0]!.content = 'SABOTAGED_PAYLOAD'
        expect(matchRecording(corrupted, byHash, new Set())).toBe(-1)
        rows.push({ session: snapshot.session.id, event: event.seq, eventType: event.type, status: match < 0 ? 'unmatched' : reconstructedHash === nearest?.request_sha256 ? 'byte-exact' : 'json-exact',
          reconstructedHash, canonicalRequestHash: digest({ ...header, messages }), canonicalSourceHash: digest(snapshot), recordedHash: nearest?.request_sha256 ?? null, recording: nearest?.file ?? null,
          divergence: nearest ? divergence(body, nearest.body) : '$.unmatched', adapterDefaults: header.adapterDefaults ?? null,
          requestedSettings: Object.fromEntries(Object.entries(header.config).filter(([key]) => !Object.hasOwn(header.adapterDefaults ?? {}, key))),
          observedWireSettings: Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => !['messages', 'tools'].includes(key))), corruptionRejected: true })
      }
    }
  } finally {
    try { await providerFiber.dispose() }
    finally {
      try { await runtimeFiber.dispose() }
      finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
    }
  }
  const unmatchedRecordings = records.flatMap((record, index) => {
      if (used.has(index)) return []
      const body = record.body as { messages?: { role: string; content: unknown }[] }
      const system = body.messages?.find(m => m.role === 'system')?.content
      return [{ index, file: record.file, requestHash: record.request_sha256, requestId: record.request_id,
        classification: typeof system === 'string' && system.startsWith('Create a concise title for an AI coding-assistant session from the supplied human messages.') ? 'auxiliary-session-title' : record.proxy_write_error ? 'client-disconnected-without-settlement' : 'unresolved',
        proxyWriteError: record.proxy_write_error ?? null,
        systemHash: digest(system ?? null) }]
    })
  await atomicJson(manifest.output, { adapter: 'installed PiAiAdapter with offline fetch capture', settingsHash: digest(settings), rows,
    recordingScope: manifest.recordingScope, unmatchedRecordings, rendererApproved: false })
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.filter(row => row.status !== 'byte-exact')).toEqual([])
  if (manifest.recordingScope === 'complete') expect(unmatchedRecordings.filter(record => record.classification === 'unresolved')).toEqual([])
}, 120_000)
