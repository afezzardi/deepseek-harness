/** Interaction tests use real React rendering and isolated model-directory stores. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { EffortSlider, type EffortSliderProps } from '../src/client/EffortSlider.tsx'
import { en } from '../src/client/locales.ts'

const t: EffortSliderProps['t'] = key => en[key as keyof typeof en] ?? key
function initial(): ModelDirectoryState {
  return {
    current: { provider: 'local-qwen', model: 'chat-model', reasoningEffort: 'medium' },
    routable: true, status: 'ready', error: null, failures: [],
    groups: [{ id: 'local-qwen', name: 'Local Qwen', models: [{
      id: 'chat-model', name: 'Qwen', reasoning: {
        defaultEffort: 'medium',
        efforts: ['off', 'low', 'medium', 'xhigh'].map(id => ({ id, name: id })),
      },
    }] }],
  }
}

function bench(state = initial()) {
  const store = createSnapshotStore(state)
  const directory = {
    store,
    load: vi.fn(async () => store.getSnapshot()),
    select: vi.fn(async (selection: ModelSelection) => {
      store.update(value => { value.current = selection })
    }),
  }
  const view = render(<EffortSlider directory={directory} available t={t} />)
  fireEvent.click(screen.getByRole('button', { name: 'Effort · medium' }))
  return { directory, ...view }
}

afterEach(cleanup)

describe('effort control', () => {
  it('previews a drag without requests and commits the provider ID on release', async () => {
    const { directory } = bench()
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '3' } })
    expect(directory.select).not.toHaveBeenCalled()
    expect(slider.getAttribute('aria-valuetext')).toBe('xhigh')
    fireEvent.pointerUp(slider)
    await waitFor(() => expect(directory.select).toHaveBeenCalledExactlyOnceWith({
      provider: 'local-qwen', model: 'chat-model', reasoningEffort: 'xhigh',
    }))
    expect(screen.getByRole('button', { name: 'Effort · xhigh' })).toBeTruthy()
    expect(screen.getByRole('slider')).toBe(slider)
    expect(document.activeElement).toBe(slider)
  })

  it('commits keyboard changes and leaves unchanged levels alone', async () => {
    const { directory } = bench()
    fireEvent.keyUp(screen.getByRole('slider'), { key: 'Enter' })
    expect(directory.select).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    fireEvent.keyUp(screen.getByRole('slider'), { key: 'Home' })
    await waitFor(() => expect(directory.select).toHaveBeenCalledOnce())
    expect(directory.select.mock.calls[0]?.[0].reasoningEffort).toBe('off')
  })

  it('admits only one pending submission and reports failure without showing a saved value', async () => {
    const { directory } = bench()
    let reject!: (reason: Error) => void
    directory.select.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    fireEvent.pointerUp(screen.getByRole('slider'))
    fireEvent.keyUp(screen.getByRole('slider'), { key: 'Enter' })
    expect(directory.select).toHaveBeenCalledOnce()
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true)
    await act(async () => { reject(new Error('selection refused')) })
    expect(screen.getByRole('alert').textContent).toBe(en.failed)
    expect(screen.getByRole('button', { name: 'Effort · medium' })).toBeTruthy()
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('2')
  })

  it('discards cancelled drafts and closes on Escape with focus restored', () => {
    const { directory } = bench()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    fireEvent.pointerCancel(screen.getByRole('slider'))
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('2')
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    expect(screen.queryByRole('slider')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Effort · medium' }))
    expect(directory.select).not.toHaveBeenCalled()
  })

  it('follows an external model selection and discards the old draft', () => {
    const { directory } = bench()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    act(() => directory.store.update(value => { value.current = { provider: 'local-qwen', model: 'chat-model', reasoningEffort: 'low' } }))
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('1')
    expect(directory.select).not.toHaveBeenCalled()
  })

  it('keeps a newer external selection when an older submission fails', async () => {
    const { directory } = bench()
    let reject!: (reason: Error) => void
    directory.select.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    fireEvent.pointerUp(screen.getByRole('slider'))
    act(() => directory.store.update(value => {
      value.current = { provider: 'local-qwen', model: 'chat-model', reasoningEffort: 'low' }
    }))
    await act(async () => { reject(new Error('older selection refused')) })
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('1')
    expect(screen.getByRole('button', { name: 'Effort · low' })).toBeTruthy()
  })

  it('does not invent capabilities for a model without reasoning metadata', () => {
    const state = initial()
    state.groups = [{ id: 'local-qwen', name: 'Qwen', models: [{ id: 'chat-model', name: 'Qwen' }] }]
    const directory = { store: createSnapshotStore(state), load: vi.fn(async () => state), select: vi.fn() }
    render(<EffortSlider directory={directory} available t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Effort' }))
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByText(en.unavailable)).toBeTruthy()
  })

  it('does not load a directory for an addressed subagent', () => {
    const state = initial()
    const directory = { store: createSnapshotStore(state), load: vi.fn(async () => state), select: vi.fn() }
    render(<EffortSlider directory={directory} available={false} t={t} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(directory.load).not.toHaveBeenCalled()
  })

  it('settles a pending request safely after unmount', async () => {
    const { directory, unmount } = bench()
    let resolve!: () => void
    directory.select.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    fireEvent.pointerUp(screen.getByRole('slider'))
    unmount()
    await act(async () => { resolve() })
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it.each([false, true])('restores browser-blurred focus without stealing another control (moved=%s)', async moved => {
    const { directory } = bench()
    let resolve!: () => void
    directory.select.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    const slider = screen.getByRole('slider') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.keyUp(slider, { key: 'End' })
    // jsdom does not reproduce Chromium's blur when an input becomes disabled.
    slider.blur()
    const close = screen.getByRole('button', { name: en.close })
    if (moved) close.focus()
    await act(async () => { resolve() })
    expect(document.activeElement).toBe(moved ? close : slider)
  })
})
