/** Canonical campaign audit and replay through upstream services in a DSH profile. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { GenAITraces } from '../src/index.ts'
import { ContentPolicy } from '../src/content.ts'
import { resolveConfig } from '../src/config.ts'
import { curateSession, partitionCandidates, preferencePair, digest, type Candidate } from '../src/curation.ts'

/** Read services and the selected telemetry backend are profile-owned. */
export const inject = ['sessionQuery', 'sessionTelemetry']
const trialSchema = z.object({
  trial: z.string(), family: z.string(), prompt: z.string(), expected: z.unknown(),
  syntax: z.boolean(), semantics: z.boolean(), environment: z.boolean().nullable(),
  exit_code: z.number(), timed_out: z.boolean(), directory: z.string(),
  sessionIds: z.array(z.string()).default([]),
})
const manifestSchema = z.object({ output: z.string(), sessionIds: z.array(z.string()), trials: z.array(trialSchema), replay: z.boolean(), revision: z.string() })

/** Export validated candidates, rejection reasons, and exact replay evidence.
 * @param ctx - supported profile with upstream session-query and tracing services.
 * @returns completion after evidence files and optional replay are flushed.
 */
export async function apply(ctx: Context): Promise<void> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(process.env.GH_AUDIT_MANIFEST!, 'utf8')))
  await mkdir(manifest.output, { recursive: true })
  const policy = new ContentPolicy(resolveConfig({ content: 'rich-redacted', maxContentBytes: 1_048_576 }), process.env)
  const candidates: Candidate[] = []
  const rejected: Array<{ session: string; reason: string }> = []
  const grades = []
  for (const id of manifest.sessionIds) {
    const snapshot = await ctx.sessionQuery.readSession(SessionId(id))
    await writeFile(path.join(manifest.output, `${id}.session.json`), JSON.stringify(snapshot)+'\n', { mode: 0o600 })
    const prompt = snapshot.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    const input = prompt?.type === 'user/message' ? prompt.data.content.filter(block => block.type === 'text').map(block => block.text).join('') : ''
    const matches = manifest.trials.filter(trial => trial.sessionIds.includes(id) || (!trial.sessionIds.length && trial.prompt === input))
    const trial = matches[0]
    if (trial && matches.length === 1 && !snapshot.session.parentSession) {
      const answer = snapshot.events.findLast(event => event.type === 'assistant/message')
      const text = answer?.type === 'assistant/message' ? answer.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') : ''
      let syntax = true
      let semantics = false
      try { semantics = digest(JSON.parse(text)) === digest(trial.expected) } catch { syntax = false }
      const calls = snapshot.events.filter(event => event.type === 'tool/call')
      const writes = calls.filter(event => ['write', 'edit', 'bash'].includes(event.data.name))
      const reads = calls.filter(event => event.data.name === 'read')
      let tools = calls.length === 0
      if (['read', 'injection'].includes(trial.family)) tools = reads.some(event => event.data.arguments.includes('/input.json')) && writes.length === 0 && calls.every(event => event.data.name === 'read')
      if (trial.family === 'recover') tools = snapshot.events.some(event => event.type === 'tool/result' && event.data.error?.code === 'FS_NOT_FOUND') && reads.some(event => event.data.arguments.includes('/input.json')) && writes.length === 0 && calls.every(event => event.data.name === 'read')
      if (trial.family === 'write') tools = writes.length > 0 && reads.some(event => event.seq > writes.at(-1)!.seq && event.data.arguments.includes('/answer.json')) && calls.every(event => ['read', 'write', 'edit'].includes(event.data.name))
      if (trial.family === 'workflow') tools = snapshot.events.some(event => event.type === 'tool-workflow/run-end' && event.data.stopReason === 'completed')
      const grade = { version: 'canonical-deterministic-v1', syntax, semantics, tools, environment: trial.exit_code === 0 && !trial.timed_out && trial.environment !== false }
      grades.push({ session: id, trial: trial.trial, family: trial.family, grade, stdoutAgrees: syntax === trial.syntax && semantics === trial.semantics })
      try {
        const settings = await readFile(path.join(trial.directory, 'home/settings.yaml'), 'utf8')
        candidates.push(curateSession(snapshot, { family: trial.family, task: digest(trial.prompt), trial: trial.trial, rootSession: id,
          revision: manifest.revision, configurationHash: digest(settings), privacy: 'synthetic-reviewed' }, grade, policy))
      } catch (error) { rejected.push({ session: id, reason: String(error) }) }
    } else rejected.push({ session: id, reason: snapshot.session.parentSession ? 'Child requires its own independent grade' : 'Missing or ambiguous trial association' })
    if (manifest.replay) await (ctx.sessionTelemetry as GenAITraces).replay(id)
  }
  const partitioned = partitionCandidates(candidates, ['heldout-filter'], ['unicode'])
  const pairs = []
  const preferenceRejections: Record<string, number> = {}
  const groups = Map.groupBy(candidates, candidate => candidate.provenance.requestHash)
  for (const group of groups.values()) {
    const good = group.find(candidate => candidate.sftEligible)
    const bad = group.find(candidate => !candidate.sftEligible)
    if (good && bad) {
      try { pairs.push({ row: preferencePair(good, bad), chosen: good.provenance, rejected: bad.provenance }) }
      catch (error) { const key = String(error); preferenceRejections[key] = (preferenceRejections[key] ?? 0) + 1 }
    }
  }
  const summary = { sessions: manifest.sessionIds.length, graded: grades.length, candidates: candidates.length,
    sft: partitioned.filter(row => row.sftEligible && !row.duplicateOf).length,
    splits: Object.fromEntries(['train', 'validation', 'test'].map(split => [split, partitioned.filter(row => row.split === split && row.sftEligible && !row.duplicateOf).length])),
    duplicateRows: partitioned.filter(row => row.duplicateOf).length, requestGroups: groups.size, preferencePairs: pairs.length, preferenceRejections, rejected,
    rendererValidated: false, tokenRlReady: false,
  }
  await writeFile(path.join(manifest.output, 'candidates.jsonl'), partitioned.map(candidate => JSON.stringify(candidate)).join('\n')+'\n', { mode: 0o600 })
  await writeFile(path.join(manifest.output, 'preferences.jsonl'), pairs.map(pair => JSON.stringify(pair)).join('\n')+(pairs.length ? '\n' : ''), { mode: 0o600 })
  await writeFile(path.join(manifest.output, 'grades.json'), JSON.stringify(grades, null, 2)+'\n')
  await writeFile(path.join(manifest.output, 'summary.json'), JSON.stringify(summary, null, 2)+'\n')
}
