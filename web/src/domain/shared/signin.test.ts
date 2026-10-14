import { describe, expect, it } from 'vitest'
import { cleanCode, initials, isCompleteCode, isEmail } from './signin'

describe('auth.md · Sign-in — shape checks', () => {
  it.each(['juan@correo.co', ' ana.perez@mail.com '])('accepts «%s»', (email) => {
    expect(isEmail(email)).toBe(true)
  })

  it.each(['', 'juan', 'juan@', '@correo.co', 'juan@correo', 'juan @correo.co'])(
    'rejects «%s»',
    (email) => {
      expect(isEmail(email)).toBe(false)
    },
  )

  it('keeps only six digits of whatever is typed or pasted', () => {
    expect(cleanCode('48 1-9a37')).toBe('481937')
    expect(cleanCode('4819370000')).toBe('481937')
    expect(isCompleteCode(cleanCode('4819'))).toBe(false)
    expect(isCompleteCode(cleanCode('481937'))).toBe(true)
  })

  it.each([
    ['Carolina Mejía', 'CM'],
    ['carolina', 'C'],
    ['Ana María Pérez', 'AP'],
    ['', ''],
  ])('«%s» → «%s»', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})
