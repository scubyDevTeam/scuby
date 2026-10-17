// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { draftKey, readDraft, useSavedDraft } from './saved-draft'

beforeEach(() => localStorage.clear())
const key = draftKey('lost', 'u1')

describe('useSavedDraft — a publish form survives a reload', () => {
  it('keeps what is typed, and a new form opens on it', () => {
    const first = renderHook(() => useSavedDraft(key, { name: '' }))
    expect(first.result.current.restored).toBe(false)
    act(() => first.result.current.setValue({ name: 'Luna' }))
    first.unmount()

    const again = renderHook(() => useSavedDraft(key, { name: '' }))
    expect(again.result.current.value).toEqual({ name: 'Luna' })
    expect(again.result.current.restored).toBe(true)
  })

  it('starting over empties the form and forgets it', () => {
    localStorage.setItem(
      key,
      JSON.stringify({ v: 1, savedAt: Date.now(), value: { name: 'Luna' } }),
    )
    const form = renderHook(() => useSavedDraft(key, { name: '' }))
    act(() => form.result.current.discard())
    expect(form.result.current.value).toEqual({ name: '' })
    expect(form.result.current.restored).toBe(false)
  })

  it('once published nothing is kept, even if the form renders again', () => {
    const form = renderHook(() => useSavedDraft(key, { name: '' }))
    act(() => form.result.current.setValue({ name: 'Luna' }))
    act(() => form.result.current.clear())
    act(() => form.result.current.setValue({ name: 'Otra' }))
    expect(readDraft(key)).toBeNull()
  })

  it('a draft older than a week is not offered, nor one of another account', () => {
    localStorage.setItem(
      key,
      JSON.stringify({ v: 1, savedAt: Date.now() - 8 * 86_400_000, value: { name: 'Luna' } }),
    )
    expect(readDraft(key)).toBeNull()
    expect(readDraft(draftKey('lost', 'u2'))).toBeNull()
  })
})
