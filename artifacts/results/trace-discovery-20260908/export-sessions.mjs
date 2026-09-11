/** Dated read-only audit through upstream session-query, mounted by a DSH profile. */
import { readFile, writeFile } from 'node:fs/promises'

export const inject = ['sessionQuery']

/** Save validated logical snapshots for the explicit discovery session list.
 * @param ctx - DSH profile context with the upstream session-query service.
 * @returns completion after every requested snapshot is saved.
 */
export async function apply(ctx) {
  const ids = JSON.parse(await readFile(new URL(process.env.GH_DISCOVERY_IDS ?? './session-ids.json', import.meta.url), 'utf8'))
  for (const id of ids) {
    const snapshot = await ctx.sessionQuery.readSession(id)
    await writeFile(new URL(`./${id}.session.json`, import.meta.url), JSON.stringify(snapshot) + '\n', { mode: 0o600 })
  }
}
