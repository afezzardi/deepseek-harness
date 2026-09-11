/** Build with the checkout's toolchain; emit the client-module factory DSH loads. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'

const root = fileURLToPath(new URL('./', import.meta.url))
const id = '@deepseek-ai/dsh-local-effort-slider'
const common = { cwd: root, config: false, outDir: 'lib', dts: false, clean: false, target: 'es2024' }
await build({ ...common, entry: { index: 'src/index.ts' }, format: 'esm', platform: 'node', fixedExtension: false })
await build({
  ...common,
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  platform: 'browser',
  sourcemap: true,
  deps: { neverBundle: [/^react(?:\/|$)/], alwaysBundle: [/^\.\//] },
  plugins: [{
    name: 'local-effort-css-text',
    resolveId(path) {
      if (path === './style.css') return '\0local-effort-style.js'
    },
    async load(path) {
      if (path === '\0local-effort-style.js') {
        return `export default ${JSON.stringify(await readFile(new URL('./src/client/style.css', import.meta.url), 'utf8'))}`
      }
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})

// A profile overlay resolves modules from the profile's directory, not this file.
// Generate the absolute path so moving this checkout only requires rebuilding.
await mkdir(new URL('./lib/', import.meta.url), { recursive: true })
await writeFile(new URL('./lib/overlay.yml', import.meta.url),
  `- insert:\n    - id: local-effort-slider\n      name: ${JSON.stringify(fileURLToPath(new URL('./lib/index.js', import.meta.url)))}\n`)
