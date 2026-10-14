import { describe, expect, it } from 'vitest'
import { toE164 } from './phone'

// The v1 row of supported_countries (auth.md): +57, ten digits starting with 3.
const colombia = { prefix: '+57', mobilePattern: '^3\\d{9}$' }

describe('auth.md · phone validation from a supported_countries row', () => {
  it.each([
    ['3114829017', '+573114829017'],
    ['311 482 9017', '+573114829017'],
    ['311-482-9017', '+573114829017'],
  ])('accepts «%s»', (input, e164) => {
    expect(toE164(input, colombia)).toBe(e164)
  })

  it.each(['', '311482901', '31148290170', '6044829017', 'abc'])('rejects «%s»', (input) => {
    expect(toE164(input, colombia)).toBeNull()
  })

  it('follows the row, not Colombia', () => {
    const other = { prefix: '+1', mobilePattern: '^\\d{10}$' }
    expect(toE164('6044829017', other)).toBe('+16044829017')
  })
})
