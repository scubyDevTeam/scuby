import { describe, expect, it } from 'vitest'
import { buttonClass } from './Button'

const widths = (classes: string) => classes.split(/\s+/).filter((c) => /^w-/.test(c))

describe('buttonClass — one width per button', () => {
  it('fills its row by default, and a link sits inline', () => {
    expect(widths(buttonClass('primary'))).toEqual(['w-full'])
    expect(widths(buttonClass('link'))).toEqual(['w-auto'])
  })

  it('a width the caller gives replaces the variant’s, never joins it', () => {
    expect(widths(buttonClass('outline', 'w-auto'))).toEqual(['w-auto'])
    expect(widths(buttonClass('link', 'w-full'))).toEqual(['w-full'])
  })

  it('a responsive width keeps the base one for small screens', () => {
    expect(widths(buttonClass('whatsapp', 'lg:w-auto'))).toEqual(['w-full'])
  })
})
