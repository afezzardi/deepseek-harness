/** Explicit benchmark reasoning configuration, logged by the normal request pipeline. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

const schema = z.object({ effort: z.string().min(1) }).strict()
/** Deployment-supplied reasoning effort for every benchmark agent request. */
export type Config = z.infer<typeof schema>
/** Preserve exact configuration for explicit validation. */
export const Config: Schema<Config> = Schema.any()

/** Install a benchmark request policy without changing messages or tools.
 * @param ctx - profile-owned context.
 * @param config - reasoning effort frozen in the task dataset.
 */
export function apply(ctx: Context, config: Config): void {
  const { effort } = schema.parse(config)
  ctx.on('agent/request', async (_request, next) => ({ ...await next(), reasoningEffort: ReasoningEffortId(effort) }))
}
