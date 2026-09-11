/**
 * Provider-declared effort selection over the resident ModelDirectory.
 * The trigger reflects the Host projection; only the open range owns a draft.
 * No provider vocabulary, settings document, or model RPC is implemented here.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection, ModelReasoningEffort } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

/** Shared directory operations consumed by the control. */
export interface EffortSliderProps {
  /** Same controller used by the native picker and /model command. */
  directory: Pick<ModelDirectory, 'store' | 'load' | 'select'>
  /** False for addressed subagents, whose history must not be activated by this UI. */
  available: boolean
  /** Typed, plugin-owned copy; effort labels themselves come from the provider. */
  t: TranslateNS<'local-effort'>
}

/**
 * Render the control for one Session's shared model directory.
 * @param props - session directory, availability, and locale translator.
 * @returns a composer control, or nothing for addressed subagents.
 */
export function EffortSlider({ directory, available, t }: EffortSliderProps) {
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  useEffect(() => {
    setOpen(false)
    if (available) void directory.load().catch(() => { /* The shared store owns catalog failures. */ })
  }, [directory, available])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (!available) return null
  const current = state.current
  const model = state.groups.find(group => group.id === current?.provider)
    ?.models.find(entry => entry.id === current?.model)
  const efforts = model?.reasoning?.efforts ?? []
  const effective = current?.reasoningEffort ?? model?.reasoning?.defaultEffort
  const index = efforts.findIndex(effort => effort.id === effective)
  const usable = current !== null && index >= 0 && efforts.length > 1 && state.routable === true
  const close = () => { setOpen(false); trigger.current?.focus() }

  return <div className="dsh-local-effort" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); close() }
  }}>
    <button type="button" ref={trigger} className="dsh-local-effort-trigger"
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      {t('effort')}{index >= 0 ? ` · ${efforts[index]?.name}` : ''}
    </button>
    {open && <section className="dsh-local-effort-panel" id={panelId} aria-label={t('choose')}>
      <div className="dsh-local-effort-heading"><strong>{t('choose')}</strong>
        <button type="button" aria-label={t('close')} onClick={close}>×</button></div>
      {usable && current !== null
        ? <EffortRange key={JSON.stringify([current.provider, current.model, efforts])} directory={directory} current={current}
            efforts={efforts} index={index} selecting={state.status === 'selecting'} t={t} />
        : <p>{state.status === 'loading' ? t('loading') : t('unavailable')}</p>}
      {state.status === 'error' && state.error !== null && <div role="alert">
        <p>{state.error}</p>
        <button type="button" onClick={() => { void directory.load().catch(() => { /* Store owns the error. */ }) }}>{t('retry')}</button>
      </div>}
    </section>}
  </div>
}

interface RangeProps extends Pick<EffortSliderProps, 'directory' | 't'> {
  current: ModelSelection
  efforts: readonly ModelReasoningEffort[]
  index: number
  selecting: boolean
}

function EffortRange({ directory, current, efforts, index, selecting, t }: RangeProps) {
  const [preview, setPreview] = useState(index)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  // Pointer-up and key-up can arrive before React paints pending=true. This
  // synchronous latch prevents both events from submitting the same draft.
  const busy = useRef(false)
  const mounted = useRef(true)
  const input = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(false)
  const projectedIndex = useRef(index)
  const inputId = useId()
  useEffect(() => {
    mounted.current = true
    input.current?.focus()
    return () => { mounted.current = false }
  }, [])
  // Updating the projected level must preserve the input node and keyboard
  // focus. Only a different model or effort catalog remounts this range.
  useEffect(() => {
    projectedIndex.current = index
    setPreview(index)
    setError(false)
  }, [index])
  useEffect(() => {
    if (pending || selecting || !restoreFocus.current) return
    restoreFocus.current = false
    // Chromium blurs a focused input when it becomes disabled. Restore it
    // after saving only if the user has not focused another control meanwhile.
    if (document.activeElement === document.body) input.current?.focus()
  }, [pending, selecting])

  const commit = async (value: number) => {
    if (busy.current || selecting || value === index) return
    const effort = efforts[value]
    if (effort === undefined) return
    busy.current = true
    restoreFocus.current = document.activeElement === input.current
    setPending(true)
    setError(false)
    try {
      // ModelDirectory owns RPC errors and durable selection projection. Keep
      // the provider/model pair captured by this range, never a fallback model.
      await directory.select({ ...current, reasoningEffort: effort.id })
    } catch {
      // Another picker can change the projection while this request is pending.
      // A late failure resets to that selection, not the submission's old one.
      if (mounted.current) { setError(true); setPreview(projectedIndex.current) }
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }

  return <div>
    <label className="dsh-local-effort-value" htmlFor={inputId}>{efforts[preview]?.name}</label>
    <input ref={input} id={inputId} type="range" min={0} max={efforts.length - 1} step={1} value={preview}
      aria-label={t('choose')} aria-valuetext={efforts[preview]?.name} disabled={pending || selecting}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onChange={event => { setPreview(Number(event.currentTarget.value)); setError(false) }}
      onPointerUp={event => { void commit(Number(event.currentTarget.value)) }}
      onPointerCancel={() => setPreview(index)}
      onKeyUp={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter'].includes(event.key)) {
          void commit(Number(event.currentTarget.value))
        }
      }}
      onBlur={() => { if (!busy.current) setPreview(index) }} />
    <div className="dsh-local-effort-ticks" aria-hidden="true">
      {efforts.map(effort => <span key={effort.id}>{effort.name}</span>)}
    </div>
    <p role="status">{pending || selecting ? t('pending') : t('next')}</p>
    {error && <p role="alert">{t('failed')}</p>}
  </div>
}
