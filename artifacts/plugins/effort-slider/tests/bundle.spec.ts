/** Built factory smoke: use real Cordis effect ownership and the slot registry. */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '../../../../packages/client/ui-renderer/src/client/registry.ts'
import { expect, it, vi } from 'vitest'

it('loads the built client factory and disposes its styles, locale, and slot', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const unregister = vi.fn()
  ctx.provide('locale', { register: vi.fn(() => unregister) })
  ctx.provide('sessions', {})
  ctx.provide('modelDirectories', {})
  ctx.provide('remote', {})
  ctx.provide('remote.session', {})
  try {
    const releaseOwner = ctx.slots.register({ name: 'root', children: {
      'conversation.input.left': { kind: 'list', scope: 'session' },
    } }, (_props: PropsRenderSlots<'conversation.input.left'>) => null)
    let plugin: { apply: (context: Context) => void; inject: string[] } | undefined
    const required: string[] = []
    runInNewContext(await readFile(`${import.meta.dirname}/../lib/client.js`, 'utf8'), {
      document,
      window: { __ModuleLoader__: { load(module: {
        id: string
        factory: (require: (id: string) => unknown) => typeof plugin
      }) {
        expect(module.id).toBe('@deepseek-ai/dsh-local-effort-slider')
        plugin = module.factory(id => {
          required.push(id)
          if (id === 'react') return React
          if (id === 'react/jsx-runtime') return jsx
          throw new Error(`Unexpected browser dependency: ${id}`)
        })
      } } },
    })
    expect(required.length).toBeGreaterThan(0)
    expect(plugin).toBeDefined()
    const fork = ctx.plugin(plugin!)
    await fork.await()
    expect(ctx.slots.entriesOfSlot('conversation.input.left')).toHaveLength(1)
    expect(document.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-local-effort-slider"]')).toHaveLength(1)
    await fork.dispose()
    expect(ctx.slots.entriesOfSlot('conversation.input.left')).toHaveLength(0)
    expect(document.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-local-effort-slider"]')).toHaveLength(0)
    expect(unregister).toHaveBeenCalledOnce()
    releaseOwner()
  } finally { await ctx.fiber.dispose() }
})
