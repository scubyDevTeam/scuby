import { describe, expect, it } from 'vitest'
import { BIO_MAX_LENGTH, hasLink, profileErrors } from './profile'

describe('auth.md · Profile — the bio is plain text, no links', () => {
  it.each([
    'Escríbeme a wa.me/573001234567',
    'https://instagram.com/luna',
    'http://example.org',
    'www.mitienda.co',
    'mi perfil: instagram.com/juan',
    'linktr.ee/juan y bit.ly/abc',
    'Telegram: t.me/juan',
    'WA.ME/57300',
  ])('«%s» has a link', (bio) => {
    expect(hasLink(bio)).toBe(true)
  })

  it.each([
    'Vivo en Laureles con dos gatos.',
    'Rescatista desde 2019. Escríbeme por la app.',
    'Me gusta caminar... y ayudar.',
    '',
  ])('«%s» is plain text', (bio) => {
    expect(hasLink(bio)).toBe(false)
  })

  it('needs a name and keeps the bio short', () => {
    expect(profileErrors({ displayName: ' ', bio: '' })).toEqual(['name_required'])
    expect(profileErrors({ displayName: 'Ana', bio: 'a'.repeat(BIO_MAX_LENGTH + 1) })).toEqual([
      'bio_too_long',
    ])
    expect(profileErrors({ displayName: 'Ana', bio: 'wa.me/57300' })).toEqual(['bio_has_link'])
    expect(profileErrors({ displayName: 'Ana', bio: 'Hola' })).toEqual([])
  })
})
