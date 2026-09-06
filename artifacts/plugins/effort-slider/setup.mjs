/** Link React from this checkout without adding a workspace or downloading dependencies. */
import { lstat, mkdir, realpath, symlink } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const links = {
  react: '../../../packages/client/ui-model-selection/node_modules/react',
  'react-dom': '../../../node_modules/.pnpm/node_modules/react-dom',
  '@types/react': '../../../node_modules/.pnpm/node_modules/@types/react',
  '@types/react-dom': '../../../node_modules/.pnpm/node_modules/@types/react-dom',
}
for (const [name, source] of Object.entries(links)) {
  const target = await realpath(new URL(source, import.meta.url))
  const destination = fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url))
  await mkdir(dirname(destination), { recursive: true })
  const existing = await lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing !== undefined) {
    if (await realpath(destination) !== target) throw new Error(`Dependency at ${destination} differs from the checkout; remove that local entry before setup.`)
    continue
  }
  await symlink(relative(dirname(destination), target), destination, 'junction')
}
