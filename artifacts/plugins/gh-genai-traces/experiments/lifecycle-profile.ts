/** Two-turn persistence/resume driver mounted only through a DSH profile. */
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle, type AgentSetup } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { z } from 'zod'
import { readArtifactSnapshot } from '../src/upstream.ts'

/** Public services for creating, flushing, disposing, and resuming an agent. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'sessionQuery', 'sessionPersistence']
const taskSchema = z.object({ prompt: z.string().min(1), continuation: z.string().min(1) })

async function run(ctx: Context): Promise<void> {
  await ctx.get('loader')?.await()
  const task = taskSchema.parse(JSON.parse(await readFile(process.env.GH_LIFECYCLE_TASK!, 'utf8')))
  const selection = ctx.agentDefaultModel.currentSelection()
  const setup: AgentSetup = agentCtx => { installModelSelection(agentCtx, { current: selection, assembled: undefined }) }
  const sessionId = SessionId(`session-${randomUUID()}`)
  let handle: AgentHandle | undefined
  try {
    for (const [index, prompt] of [task.prompt, task.continuation].entries()) {
      handle = index
        ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: selection, setup })
        : await ctx.agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions: selection, setup })
      await handle.agent.whenIdle()
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }))
      await handle.agent.whenIdle()
      await ctx.sessions.flush(handle.agent.session)
      const { events } = await readArtifactSnapshot(ctx, sessionId)
      const end = events.findLast(e => e.type === 'turn/end')
      if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed') throw Error(`Lifecycle turn ${index + 1} did not complete`)
      if (index) {
        const answer = events.findLast(e => e.type === 'assistant/message')
        if (answer?.type === 'assistant/message') process.stdout.write(answer.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') + '\n')
      }
      await handle.dispose(); handle = undefined
    }
  } finally { await handle?.dispose() }
}

/** Drive a task after all profile plugins settle, then request normal launcher teardown.
 * @param ctx - supported profile context with launcher-owned exit.
 */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  if (!exit) throw Error('Lifecycle driver requires the DSH launcher')
  void run(ctx).then(() => exit(0), error => { process.stderr.write(String(error) + '\n'); exit(1) })
}
