// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { loadMessages, type Messages, messagesFor } from './locales'
import { createI18n } from './react'
import { createTranslator } from './translate'

const now = new Date('2026-10-04T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('t()', () => {
  const { t } = createI18n('es', { brand: 'Marca' })

  it('reads a key and fills its placeholders', () => {
    expect(t('case.share_title_named', { name: 'Luna' })).toBe('Comparte a Luna')
  })

  it('leaves a placeholder it was not given, so the gap is visible', () => {
    expect(t('case.share_title_named')).toBe('Comparte a {name}')
  })

  it('picks the plural form by count', () => {
    expect(t('time.days_ago', { count: 1 })).toBe('hace 1 día')
    expect(t('time.days_ago', { count: 3 })).toBe('hace 3 días')
  })

  it('falls back to the source language for a key a translation lacks', () => {
    const holey = structuredClone(messagesFor('es')) as unknown as Record<
      string,
      Record<string, string>
    >
    delete holey.common?.retry
    const english = createTranslator('en', holey as unknown as Messages, messagesFor('es'))
    expect(english.t('common.retry')).toBe('Reintentar')
  })
})

describe('relative time copy', () => {
  it.each([
    [30_000, 'hace un momento', 'just now'],
    [5 * MINUTE, 'hace 5 min', '5 min ago'],
    [2 * HOUR, 'hace 2 h', '2 h ago'],
    [DAY, 'hace 1 día', '1 day ago'],
    [2 * DAY, 'hace 2 días', '2 days ago'],
  ])('%i ms ago reads «%s» · «%s»', async (age, spanish, english) => {
    await loadMessages('en')
    expect(createI18n('es').relative(ago(age), now)).toBe(spanish)
    expect(createI18n('en').relative(ago(age), now)).toBe(english)
  })
})

describe('distances', () => {
  it.each([
    [404, '400 m', '400 m'],
    [120, '120 m', '120 m'],
    [1200, '1,2 km', '1.2 km'],
  ])('%i m reads «%s» · «%s»', async (meters, spanish, english) => {
    await loadMessages('en')
    expect(createI18n('es').distance(meters)).toBe(spanish)
    expect(createI18n('en').distance(meters)).toBe(english)
  })
})

describe('rich()', () => {
  it('wraps tagged words and places nodes', () => {
    const { rich } = createI18n('es')
    render(
      <p>
        {rich('case.unfinished', {
          place: <em>Laureles</em>,
          home: (chunks) => <a href="/">{chunks}</a>,
        })}
      </p>,
    )
    expect(screen.getByRole('link', { name: 'Ver otros avisos' })).toBeTruthy()
    expect(screen.getByText('Laureles').tagName).toBe('EM')
  })
})

describe('language files in parts', () => {
  it('a deferred namespace reads in its language once its screen has asked for it', async () => {
    await loadMessages('en', ['legal'])
    expect(createI18n('en').t('legal.terms.title')).toBe('Terms and conditions')
  })
})
