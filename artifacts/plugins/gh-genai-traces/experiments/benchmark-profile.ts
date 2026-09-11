/** Campaign tool exposure and execution policy, assembled before request logging. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'

const names = z.array(z.string().min(1)).min(1)
const schema = z.object({ effort: z.string().min(1), rootTools: names, childTools: names }).strict()
/** Frozen reasoning effort and permitted tools for root and child agents. */
export type Config = z.infer<typeof schema>
/** Preserve exact configuration for explicit validation. */
export const Config: Schema<Config> = Schema.any()

/** Services that own prompt assembly and monotonic execution guards. */
export const inject = ['tools', 'systemPrompt']

/** Install tool policies before the ordinary pipeline records each model request.
 * @param ctx - profile-owned context.
 * @param config - frozen reasoning effort and root/child tool policies.
 */
export function apply(ctx: Context, config: Config): void {
  const { effort, rootTools, childTools } = schema.parse(config)
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (!context.agent) return assembly
    const allowed = context.agent.session.header.parentSession ? childTools : rootTools
    const tools = assembly.tools.filter(tool => allowed.includes(tool.name))
    const missing = allowed.filter(name => name !== 'structured_output' && !tools.some(tool => tool.name === name))
    if (missing.length) throw Error(`Benchmark tools unavailable: ${missing.join(', ')}`)
    return { ...assembly, tools }
  })
  ctx.effect(() => ctx.tools.guard(exec => {
    if (!exec.agent) return 'Benchmark tool execution requires an owning agent'
    const allowed = exec.agent.session.header.parentSession ? childTools : rootTools
    if (!allowed.includes(exec.name)) return `Benchmark tool is not allowed: ${exec.name}`
    return undefined
  }))
  ctx.on('agent/request', async (_request, next) => ({ ...await next(), reasoningEffort: ReasoningEffortId(effort) }))
}
