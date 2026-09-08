/** Bundle plugin-owned libraries while retaining the host's DSH service identities. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
const root = fileURLToPath(new URL('./', import.meta.url))
await build({ cwd: root, config: false, tsconfig: fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url)), entry: { index: 'src/index.ts', evaluation: 'examples/evaluation.ts', curation: 'src/curation.ts', fireworks: 'src/fireworks.ts', 'render-preview': 'src/render-preview.ts', reward: 'src/reward.ts', 'frozen-profile': 'experiments/frozen-profile.ts', 'audit-profile': 'experiments/audit-profile.ts', 'lifecycle-profile': 'experiments/lifecycle-profile.ts', 'benchmark-profile': 'experiments/benchmark-profile.ts' }, outDir: 'lib', clean: true,
  platform: 'node', target: 'es2024', format: 'esm', fixedExtension: false, dts: false,
  deps: { neverBundle: [/^@deepseek-ai\/(?!(?:dsh-token-meter\/src\/turn-usage\.ts|dsh-session\/src\/surface\.ts)$)/], alwaysBundle: [/^@deepseek-ai\/(?:dsh-token-meter\/src\/turn-usage\.ts|dsh-session\/src\/surface\.ts)$/, /^@opentelemetry\//, /^zod(?:\/|$)/] },
})
await mkdir(new URL('./lib/', import.meta.url), { recursive: true })
const auditSources = ['experiments/audit-profile.ts', ...(await readdir(new URL('./src/', import.meta.url), { recursive: true })).filter(name => name.endsWith('.ts')).map(name => `src/${name}`)].sort()
const auditHashes = await Promise.all(auditSources.map(async name => [name, createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')]))
await writeFile(new URL('./lib/audit-code-identity.json', import.meta.url), JSON.stringify({ version: 1, files: Object.fromEntries(auditHashes) }) + '\n')
await writeFile(new URL('./lib/overlay.yml', import.meta.url),
  `- id: session-telemetry-otel\n  disabled: true\n- insert:\n    - id: gh-genai-traces\n      name: ${JSON.stringify(fileURLToPath(new URL('./lib/index.js', import.meta.url)))}\n      config:\n        content: rich-redacted\n        endpoint: !!js process.env.GH_GENAI_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318/v1/traces'\n        project: !!js process.env.GH_GENAI_PROJECT ?? 'gh-genai-traces'\n        replaySessionIds: !!js (process.env.GH_GENAI_REPLAY_SESSIONS ?? '').split(',').filter(Boolean)\n`)
// Dedicated source facade keeps local development outside root workspace lists.
const base = await readFile(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8')
const ts = await import('typescript')
const parsed = ts.parseConfigFileTextToJson('tsconfig.base.json', base).config
const paths = Object.fromEntries(Object.entries(parsed.compilerOptions.paths).map(([name, values]) => [name, values.map(value => `../../../${value}`)]))
paths['@deepseek-ai/dsh-session/src/surface.ts'] = ['../../../packages/core/session/src/surface.ts']
paths['@deepseek-ai/dsh-token-meter/src/turn-usage.ts'] = ['../../../packages/llm/token-meter/src/turn-usage.ts']
await writeFile(new URL('./lib/tsconfig.paths.json', import.meta.url), JSON.stringify({ compilerOptions: { paths: Object.fromEntries(Object.entries(paths).map(([name, values]) => [name, values.map(value => `../${value}`)])) } }, null, 2) + '\n')

const host = ts.parseConfigFileTextToJson('tsconfig.host.json', await readFile(new URL('../../../tsconfig.host.json', import.meta.url), 'utf8')).config
const check = { extends: ['../../../../tsconfig.base.json', './tsconfig.paths.json'], compilerOptions: { noEmit: true, composite: false, incremental: false }, include: ['../src/**/*.ts', '../tests/**/*.ts', '../examples/**/*.ts', '../experiments/**/*.ts'], references: host.references.map(ref => ({ path: `../../../../${ref.path}` })) }
await writeFile(new URL('./lib/tsconfig.check.json', import.meta.url), JSON.stringify(check, null, 2) + '\n')
