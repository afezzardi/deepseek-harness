/** Fork-local verification against already-built upstream artifacts. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('../', import.meta.url))
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})`)
}
if (process.argv.includes('--build-upstream')) run('pnpm', ['run', 'build'])
run('npm', ['ci', '--prefix', 'artifacts/plugins/gh-genai-traces', '--legacy-peer-deps', '--ignore-scripts'])
for (const name of ['gh-genai-traces', 'effort-slider']) {
  const plugin = `artifacts/plugins/${name}`
  run('node', [`${plugin}/setup.mjs`])
  run('node', [`${plugin}/build.mjs`])
  run('pnpm', ['exec', 'tsc', '-p', name === 'gh-genai-traces' ? `${plugin}/lib/tsconfig.check.json` : `${plugin}/tsconfig.json`, '--noEmit'])
  run('pnpm', ['exec', 'vitest', 'run', '--config', `${plugin}/vitest.config.ts`])
}
run('python3', ['-m', 'unittest', 'discover', '-s', 'artifacts/plugins/gh-genai-traces/experiments', '-p', 'test_*.py'])
