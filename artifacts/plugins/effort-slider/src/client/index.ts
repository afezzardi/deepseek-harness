/** Composer contribution over DSH's resident per-session model directory. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { EffortSlider } from './EffortSlider.tsx'
import { en, zh } from './locales.ts'
import css from './style.css'

/**
 * Cordis binds service methods to the calling plugin's context. Creating the
 * first directory for a Session reads remote.session inside directoryFor(),
 * so its dependencies must be declared here even without a direct RPC call.
 */
export const inject = ['slots', 'locale', 'sessions', 'modelDirectories', 'remote', 'remote.session']

/**
 * Register copy, scoped styling, and one composer control.
 * @param ctx - browser plugin context owning every registration.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('local-effort', { en, zh }))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@deepseek-ai/dsh-local-effort-slider'
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'local-effort-slider',
    locale: 'local-effort',
    inject: (sessionId) => ({
      directory: ctx.modelDirectories.directoryFor(sessionId),
      available: ctx.sessions.subagentAddress(sessionId) === undefined,
    }),
  }, EffortSlider))
}
