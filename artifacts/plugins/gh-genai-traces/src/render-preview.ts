/** Fireworks native preview verification; no training job is created. */
import { z } from 'zod'
import { exportFireworksSft } from './fireworks.ts'
import { digest, type Candidate } from './curation.ts'

const previewSchema = z.object({ examples: z.array(z.object({ renderings: z.array(z.object({
  renderedDatums: z.array(z.object({ datumIndex: z.number().int().nonnegative(), segments: z.array(z.object({ text: z.string(), lossWeight: z.number().nonnegative() })) })).min(1),
})).min(1) })).min(1) })

/** Verify a selected preview against exact expected template context and loss text.
 * @param candidate - final-answer candidate submitted for preview.
 * @param preview - native Fireworks response, never a locally fabricated renderer result.
 * @param evidence - observed model/renderer identity and exact submitted-row hash.
 * @returns per-rendering checks; token-ID parity requires separate backend evidence.
 */
export function verifyFireworksPreview(candidate: Candidate, preview: unknown, evidence: {
  model: string; renderer: string; submittedRowHash: string; expectedContext: string; responseHash: string
}) {
  const row = exportFireworksSft(candidate)
  if (!evidence.model || !evidence.renderer || evidence.submittedRowHash !== digest(row) || evidence.responseHash !== digest(preview)) throw Error('Missing or mismatched backend preview provenance')
  const parsed = previewSchema.parse(preview)
  if (parsed.examples.length !== 1) throw Error('Preview must identify exactly the submitted example')
  return parsed.examples[0]!.renderings.map(rendering => {
    const trained = rendering.renderedDatums.flatMap(d => d.segments.filter(s => s.lossWeight > 0)).map(s => s.text).join('')
    const context = rendering.renderedDatums.flatMap(d => d.segments.filter(s => s.lossWeight === 0)).map(s => s.text).join('')
    if (trained !== row.messages.at(-1)!.content) throw Error('Preview supervises content outside the selected target')
    if (context !== evidence.expectedContext) throw Error('Preview context differs from expected template rendering')
    return { model: evidence.model, renderer: evidence.renderer, datums: rendering.renderedDatums.length, lossText: trained,
      previewVerified: true, tokenIdsVerified: false, trainingReady: false }
  })
}
