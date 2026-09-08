import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { curateSession, digest, TRANSFORMATION, type Grade } from '../src/curation.ts'
import { exportFireworksSft } from '../src/fireworks.ts'
import { verifyFireworksPreview } from '../src/render-preview.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { fixture } from './fixture.ts'

it('verifies the selected preview loss and rejects context, target, and provenance corruption', async () => {
  const source = fixture('renderer-regression')
  const pass = { status: 'pass' as const, evidence: ['hand-verified fixture: read result 42, final answer The value is 42.'] }
  const grade: Grade = { version: 'fixture-v2', required: ['semantics', 'tools'], execution: { exitCode: null, timedOut: null },
    observations: { syntax: pass, semantics: pass, tools: pass, environment: { status: 'not-applicable', evidence: ['detached source regression; no environment claim'] } } }
  const candidate = curateSession(source, { family: 'renderer-regression', task: 'fixture-read-42', trial: 'reference-only', rootSession: String(source.session.id),
    revision: 'fixture', configurationHash: digest('fixture'), review: { kind: 'synthetic-fixture', reviewer: 'fixture-test', evidence: 'tests/fixture.ts', contentHash: digest(source), transformationHash: digest(TRANSFORMATION) } }, grade, new ContentPolicy(resolveConfig({ content: 'rich-redacted' }), {}))
  if (process.env.GH_RENDER_CANDIDATE) await writeFile(process.env.GH_RENDER_CANDIDATE, JSON.stringify(candidate) + '\n', { mode: 0o600 })
  const preview = { examples: [{ renderings: [{ renderedDatums: [{ datumIndex: 0, segments: [
    { text: 'verified template context', lossWeight: 0 }, { text: 'The value is 42.', lossWeight: 1 },
  ] }] }] }] }
  const evidence = { model: 'fixture-model', renderer: 'fixture-renderer', submittedRowHash: digest(exportFireworksSft(candidate)), expectedContext: 'verified template context', responseHash: digest(preview) }
  expect(verifyFireworksPreview(candidate, preview, evidence)[0]?.previewVerified).toBe(true)
  expect(() => verifyFireworksPreview(candidate, preview, { ...evidence, submittedRowHash: 'bad' })).toThrow('provenance')
  expect(() => verifyFireworksPreview(candidate, preview, { ...evidence, expectedContext: 'corrupt' })).toThrow('context')
  const corrupted = structuredClone(preview)
  corrupted.examples[0]!.renderings[0]!.renderedDatums[0]!.segments[0]!.lossWeight = 1
  expect(() => verifyFireworksPreview(candidate, corrupted, { ...evidence, responseHash: digest(corrupted) })).toThrow('outside')
  candidate.target.reasoning = 'masked'
  expect(() => exportFireworksSft(candidate)).toThrow('loss mask')
})
