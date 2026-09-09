/** Inspect campaign tool schemas through a supported profile without sending model requests. */
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, installModelSelection, type AgentSetup } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

/** Services required for model-free agent creation and prompt assembly. */
export const inject = ['agents', 'agentDefaultModel', 'systemPrompt', 'tools']

async function run(ctx: Context): Promise<void> {
  await ctx.get('loader')?.await()
  const output = process.env.GH_PREFLIGHT_OUTPUT
  if (!output) throw Error('GH_PREFLIGHT_OUTPUT is required')
  const selection = ctx.agentDefaultModel.currentSelection()
  const setup: AgentSetup = agentCtx => { installModelSelection(agentCtx, { current: selection, assembled: undefined }) }
  const root = await ctx.agents.create({ sessionId: SessionId(`session-${randomUUID()}`), meta: { cwd: process.cwd() }, agentOptions: selection, setup })
  try {
    const parent = await ctx.systemPrompt.assemble(assembleContextFor(root.agent))
    const child = await ctx.agents.create({ sessionId: SessionId(`session-${randomUUID()}`), meta: { cwd: process.cwd(), parentSession: root.agent.session.id, origin: 'subagent' }, agentOptions: selection, setup })
    try {
      const nested = await ctx.systemPrompt.assemble(assembleContextFor(child.agent))
      let executed = false
      const dispose = ctx.effect(() => ctx.tools.register({ name: 'gh_preflight_forbidden', description: 'Keyless execution control.', parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'null' }, render: () => [] }, execute: async () => { executed = true; return null } }))
      try {
        for (const agent of [root.agent, child.agent]) {
          const rejected = await ctx.tools.execute({ name: 'gh_preflight_forbidden', callId: ToolCallId(randomUUID()), arguments: {}, agent, signal: new AbortController().signal })
          if (executed || !rejected.isError || !JSON.stringify(rejected.content).includes('Benchmark tool is not allowed')) throw Error('Benchmark execution guard failed')
        }
      } finally { await dispose() }
      await writeFile(output, JSON.stringify({ root: parent.tools, child: nested.tools, forbiddenExecutionRejected: true }, null, 2) + '\n', { mode: 0o600 })
    } finally { await child.dispose() }
  } finally { await root.dispose() }
}

/** Inspect configured root and child schemas, dispose both agents, and exit the launcher.
 * @param ctx - supported DSH profile with ordinary task startup disabled.
 */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  if (!exit) throw Error('Preflight requires the DSH launcher')
  void run(ctx).then(() => exit(0), error => { process.stderr.write(String(error) + '\n'); exit(1) })
}
