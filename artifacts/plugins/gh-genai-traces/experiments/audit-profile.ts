/** Resumable canonical audit; telemetry and publication cannot discard grading. */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenAITraces } from '../src/index.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { curateSession, partitionCandidates, preferencePair, digest, TRANSFORMATION, type Candidate, type Grade, type SplitAssignment } from '../src/curation.ts'
import { readArtifactSnapshot } from '../src/snapshot.ts'
import { atomicJson, atomicText, checkpoint, DeterministicRejection } from '../src/checkpoint.ts'
import { gradeTask } from '../src/grading.ts'
import type { inventoryWorkspace } from '../src/reward.ts'
import { exportFireworksSft } from '../src/fireworks.ts'

/** Persistence and telemetry are profile-owned services. */
export const inject = ['sessions', 'sessionPersistence', 'sessionTelemetry']
const manifestSchema = z.object({ output: z.string(), sessionIds: z.array(z.string()), trials: z.array(z.object({
  trial: z.string(), family: z.string(), prompt: z.string(), expected: z.unknown(), directory: z.string(),
  sessionIds: z.array(z.string()), exit_code: z.number(), timed_out: z.boolean(),
  task_id: z.string().optional(), workspace: z.string().optional(), before: z.record(z.string(), z.object({ kind: z.enum(['file', 'directory', 'symlink', 'other']), hash: z.string().nullable() })).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(), allowed_tools: z.array(z.string()).optional(), required_reads: z.array(z.string()).optional(),
  required_calls: z.record(z.string(), z.number().int().positive()).optional(),
  required: z.array(z.enum(['syntax', 'semantics', 'tools', 'environment'])).optional(), recovery: z.boolean().optional(), required_events: z.record(z.string(), z.number().int().positive()).optional(),
  review: z.object({ reviewer: z.string(), evidence: z.string(), taskHash: z.string() }).optional(),
})), replay: z.boolean(), revision: z.string(), assignments: z.array(z.object({ keys: z.array(z.string()).min(1), split: z.enum(['train', 'validation', 'test']), version: z.string() })).default([]) })

/** Checkpoint each source result before independent trace and backend exports.
 * @param ctx - supported audit profile, which never activates recorded agents.
 * @returns after every selected session has a durable result or rejection.
 */
export async function apply(ctx: Context): Promise<void> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(process.env.GH_AUDIT_MANIFEST!, 'utf8')))
  await mkdir(manifest.output, { recursive: true, mode: 0o700 })
  const settings = resolveConfig({ content: 'rich-redacted', maxContentBytes: 1_048_576 })
  const graderHash = digest(await readFile(new URL(import.meta.url), 'utf8'))
  const policy = new ContentPolicy(settings, process.env), candidates: Candidate[] = [], grades: unknown[] = [], rejected: unknown[] = [], telemetry: unknown[] = []
  for (const id of manifest.sessionIds) {
    try {
      const snapshot = await readArtifactSnapshot(ctx, SessionId(id))
      await atomicJson(path.join(manifest.output, `${id}.session.json`), snapshot)
      const matches = manifest.trials.filter(trial => trial.sessionIds.includes(id)), trial = matches[0]
      const config = trial ? await readFile(path.join(trial.directory, 'home/settings.yaml'), 'utf8') : null
      const record = await checkpoint(path.join(manifest.output, 'checkpoints', `${id}.json`),
        { source: digest(snapshot), task: trial ?? null, grader: graderHash, config, settings, transformation: TRANSFORMATION }, async () => {
          if (!trial || matches.length !== 1 || snapshot.session.parentSession) throw new DeterministicRejection('Missing independent unambiguous task grade')
          const grade = await gradeTask(snapshot, { family: trial.family, expected: trial.expected, workspace: trial.workspace ?? trial.directory,
            cwd: process.cwd(), before: trial.before as Awaited<ReturnType<typeof inventoryWorkspace>> ?? null,
            outputs: trial.outputs ?? {}, required: trial.required ?? ['syntax', 'semantics', 'tools', 'environment'],
            requiredEvents: trial.required_events ?? {}, requiredCalls: trial.required_calls ?? {}, allowedTools: trial.allowed_tools ?? [], requiredReads: trial.required_reads ?? [], recovery: trial.recovery ?? false,
            execution: { exitCode: trial.exit_code, timedOut: trial.timed_out } })
          let candidate: Candidate | undefined, rejection: string | undefined
          try {
            const reviewValid = trial.review && trial.review.taskHash === digest({ prompt: trial.prompt, before: trial.before, outputs: trial.outputs, expected: trial.expected })
            candidate = curateSession(snapshot, { family: trial.family, task: trial.task_id ?? digest({ prompt: trial.prompt, before: trial.before }), trial: trial.trial,
              rootSession: id, revision: manifest.revision, configurationHash: digest(config),
              review: reviewValid ? { kind: 'synthetic-fixture', reviewer: trial.review!.reviewer, evidence: trial.review!.evidence,
                contentHash: digest(snapshot), transformationHash: digest(TRANSFORMATION) } : null }, grade, policy)
          } catch (error) { rejection = String(error) }
          return { grade, candidate, rejection }
        })
      if (record.result) {
        grades.push({ session: id, trial: trial?.trial, family: trial?.family, grade: record.result.grade })
        if (record.result.candidate) candidates.push(record.result.candidate)
        if (record.result.rejection) rejected.push({ session: id, reason: record.result.rejection })
      } else rejected.push({ session: id, reason: record.rejection, retryable: record.retryable })
      if (manifest.replay) {
        let result: { session: string; error?: string } = { session: id }
        try { await (ctx.sessionTelemetry as GenAITraces).replay(id) } catch (error) { result = { session: id, error: String(error) } }
        await atomicJson(path.join(manifest.output, 'telemetry', `${id}.json`), result); telemetry.push(result)
      }
    } catch (error) {
      const rejection = { session: id, reason: String(error) }; rejected.push(rejection)
      await atomicJson(path.join(manifest.output, 'read-rejections', `${id}.json`), rejection)
    }
  }
  const partitioned = partitionCandidates(candidates, manifest.assignments as SplitAssignment[])
  const pairs: unknown[] = [], exports: unknown[] = [], exportRejections: unknown[] = []
  for (const candidate of partitioned.filter(c => c.sftEligible && !c.duplicateOf)) {
    try { exports.push(exportFireworksSft(candidate)) } catch (error) { exportRejections.push({ session: candidate.provenance.session, reason: String(error) }) }
  }
  for (const group of Map.groupBy(partitioned.filter(c => c.split !== null && !c.conflictVersions.length), c => c.provenance.requestHash).values()) {
    const good = group.find(c => c.sftEligible), bad = group.find(c => c.grade.required.some(key => c.grade.observations[key].status === 'fail'))
    if (good && bad) {
      try { pairs.push({ row: preferencePair(good, bad), chosen: good.provenance, rejected: bad.provenance }) }
      catch (error) { exportRejections.push({ request: good.provenance.requestHash, reason: String(error) }) }
    }
  }
  for (const [name, rows] of Object.entries({ candidates: partitioned, preferences: pairs, 'fireworks-sft': exports })) {
    await atomicText(path.join(manifest.output, `${name}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''))
  }
  await atomicJson(path.join(manifest.output, 'grades.json'), grades)
  const failures = (grades as { grade: Grade }[]).filter(g => g.grade.required.some(key => g.grade.observations[key].status === 'fail')).length
  await atomicJson(path.join(manifest.output, 'summary.json'), { version: 2, sessions: manifest.sessionIds.length, graded: grades.length, failures,
    instances: new Set(candidates.map(c => c.provenance.task)).size, families: new Set(candidates.map(c => c.provenance.family)).size,
    candidates: candidates.length, eligibleTargets: partitioned.filter(c => c.sftEligible && !c.duplicateOf).length,
    conflicts: partitioned.filter(c => c.conflictVersions.length).map(c => ({ session: c.provenance.session, versions: c.conflictVersions })),
    rejected, telemetry, exportRejections, rendererValidated: false, tokenRlReady: false })
}
