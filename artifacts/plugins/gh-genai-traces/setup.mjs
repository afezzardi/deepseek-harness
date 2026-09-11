/** Link the checked-out DSH peers; npm owns only external dependencies here. */
import { readFile, realpath, mkdir, lstat, symlink } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const peers = {
  '@deepseek-ai/dsh-home-paths': 'packages/util/home-paths',
  '@deepseek-ai/dsh-message-feedback': 'packages/feedback/message-feedback',
  '@deepseek-ai/node-addon-system': 'native/system/packages/entry',
  '@deepseek-ai/dsh-user-approval': 'packages/interaction/user-approval',
  '@deepseek-ai/dsh-agent': 'packages/core/agent',
  '@deepseek-ai/dsh-brand': 'packages/util/brand',
  '@deepseek-ai/dsh-session-persistence': 'packages/session/session-persistence',
  '@deepseek-ai/dsh-loader-smoke': 'packages/test-support/loader-smoke',
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/schemastery': 'vendor/schemastery',
  '@deepseek-ai/dsh-session': 'packages/core/session',
  '@deepseek-ai/dsh-llm': 'packages/llm/llm',
  '@deepseek-ai/dsh-session-telemetry': 'packages/session/session-telemetry',
  '@deepseek-ai/dsh-session-query': 'packages/session-query/session-query',
  '@deepseek-ai/dsh-token-meter': 'packages/llm/token-meter',
  '@deepseek-ai/dsh-tool-workflow': 'packages/workflow/tool-workflow',
}
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
for (const [name, source] of Object.entries(peers)) {
  const target = await realpath(new URL(`../../../${source}`, import.meta.url))
  const destination = fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url))
  await mkdir(dirname(destination), { recursive: true })
  const existing = await lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing) {
    if (await realpath(destination) !== target) throw new Error(`Unexpected dependency at ${destination}; remove it before setup`)
  } else await symlink(relative(dirname(destination), target), destination, 'junction')
}
console.log(`${manifest.name}: linked ${Object.keys(peers).length} checkout peers`)
