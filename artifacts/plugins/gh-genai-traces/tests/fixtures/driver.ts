/** Built-plugin smoke over the shipped headless profile and a real shell tool. */
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type { GenAITraces } from '../../src/index.ts'

const patch = process.argv[2]
if (!patch) throw Error('Expected a test patch')
const captures: string[] = []
const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', chunk => chunks.push(chunk as Buffer))
  request.on('end', () => {
    captures.push(Buffer.concat(chunks).toString('base64'))
    response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end()
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw Error('Collector address missing')
process.env.GH_GENAI_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}/v1/traces`
process.env.GH_GENAI_FIXTURE_SECRET = 'fixture-secret-not-for-export'
try {
  const ctx = await bootProductionProfile({ binName: 'gh-genai-traces-test', profile: 'headless', overlayPaths: [patch] })
  try {
    await runFixtureTurn(ctx, { task: 'Prove the tool round trip. fixture-secret-not-for-export' })
    const [agent] = ctx.agents.roots()
    if (!agent) throw Error('No agent created')
    await ctx.parallel('session/flush', agent.session)
    const before = agent.session.snapshotEvents()
    const backend = ctx.sessionTelemetry as GenAITraces
    await backend.replay(String(agent.session.id))
    const after = agent.session.snapshotEvents()
    await writeFile('result.json', JSON.stringify({ before, after, header: agent.session.header }))
  } finally {
    await ctx.fiber.dispose()
  }
  await writeFile('captures.json', JSON.stringify(captures))
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}
