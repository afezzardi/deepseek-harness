/** Experiment-only text policy, assembled before upstream logs the request. */
import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Explicit sampling configuration, resolved before installing request listeners. */
const samplingSchema = z.object({
  reasoningEffort: z.string().min(1).default('medium'),
  temperature: z.number().min(0).max(2).default(0.9),
  maxTokens: z.number().int().positive().default(2048),
}).strict()
/** Sampling inputs before resolving defaults. */
export type Config = z.input<typeof samplingSchema>
/** Preserve deployment fields for strict sampling validation. */
export const Config: Schema<Config> = Schema.any()

/** Required services for the explicit experiment overlay. */
export const inject = ['systemPrompt']
/** Install a fixed one-turn text policy and sampling configuration.
 * @param ctx - supported DSH profile context; every request stays canonically logged.
 * @param config - explicit experiment sampling settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const settings = samplingSchema.parse(config)
  ctx.systemPrompt.section({ name: 'gh:frozen-text', complete: true, order: 0, text: 'Follow the user request exactly. Return only the requested JSON value, without Markdown fences or commentary.' })
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, tools: [], contexts: [] }
  })
  ctx.on('agent/request', async (_payload, next) => ({ ...await next(), reasoningEffort: ReasoningEffortId(settings.reasoningEffort), temperature: settings.temperature, maxTokens: settings.maxTokens }))
}
