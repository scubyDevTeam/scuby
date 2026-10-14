// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIsDesktop } from './viewport'

const media = (matches: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )

describe('useIsDesktop', () => {
  it.each([true, false])('reports %s from the desktop breakpoint', (matches) => {
    media(matches)
    expect(renderHook(() => useIsDesktop()).result.current).toBe(matches)
  })

  it('is false where the browser cannot say', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(() => useIsDesktop()).result.current).toBe(false)
  })
})
