/** Source tests share DSH's aliases and decorator implementation. */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../vitest.shared.ts'
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [tsconfigPaths({ projects: [fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))] }), standardDecoratorPlugin()],
  test: { execArgv: vitestExecArgv, environment: 'node', include: ['tests/**/*.spec.ts'] },
})
