// t(): a key of the language file in, the copy out. Plain TypeScript, so it runs anywhere.
import type { Locale, Messages } from './locales'

type PluralCategory = Intl.LDMLPluralRule

/** `{ "one": "1 avistamiento", "other": "{count} avistamientos" }` — picked by `count`. */
type IsPlural<T> = T extends { other: string }
  ? Exclude<keyof T, PluralCategory> extends never
    ? true
    : false
  : false

type TextKeys<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : IsPlural<T[K]> extends true
      ? never
      : TextKeys<T[K], `${P}${K}.`>
}[keyof T & string]

type PluralKeys<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : IsPlural<T[K]> extends true
      ? `${P}${K}`
      : PluralKeys<T[K], `${P}${K}.`>
}[keyof T & string]

/** Every key that holds one string. */
export type TextKey = TextKeys<Messages>
/** Every key that holds plural forms; reading one takes a `count`. */
export type PluralKey = PluralKeys<Messages>
export type MessageKey = TextKey | PluralKey

export type Params = Readonly<Record<string, string | number>>
export type CountParams = Params & { readonly count: number }

export type Translator = {
  readonly locale: Locale
  t: {
    (key: TextKey, params?: Params): string
    (key: PluralKey, params: CountParams): string
  }
  /** The template behind a key, placeholders and tags untouched — for rich text. */
  template(key: MessageKey, count?: number): string
  /** Values every message may use without being passed, like `{brand}`. */
  readonly globals: Params
  date(value: Date, options: Intl.DateTimeFormatOptions): string
  /** «Negro y canela» · «Black and tan». */
  list(items: readonly string[]): string
  /** «hace 2 h» — how long ago, for the newest pin, a card or a claim. */
  relative(then: Date, now: Date): string
  /** «400 m» · «1,2 km» (Spanish) · «1.2 km» (English). */
  distance(meters: number): string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const PLACEHOLDER = /\{(\w+)\}/g

export function interpolate(template: string, params: Params, locale: Locale): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    return typeof value === 'number' ? value.toLocaleString(locale) : value
  })
}

function lookup(messages: Messages, key: string): unknown {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

export function createTranslator(
  locale: Locale,
  messages: Messages,
  source: Messages,
  globals: Params = {},
): Translator {
  const plurals = new Intl.PluralRules(locale)
  const dates = new Map<string, Intl.DateTimeFormat>()
  const lists = new Intl.ListFormat(locale, { type: 'conjunction' })
  const metres = new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter' })
  const kilometres = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'kilometer',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })

  function template(key: MessageKey, count?: number): string {
    // A key a translation has not caught up with yet reads in the source language, never blank.
    const node = lookup(messages, key) ?? lookup(source, key)
    if (typeof node === 'string') return node
    if (typeof node === 'object' && node !== null && count !== undefined) {
      const forms = node as Partial<Record<PluralCategory, string>>
      return forms[plurals.select(count)] ?? forms.other ?? key
    }
    return key
  }

  const t = ((key: MessageKey, params: Params = {}) =>
    interpolate(
      template(key, typeof params.count === 'number' ? params.count : undefined),
      { ...globals, ...params },
      locale,
    )) as Translator['t']

  return {
    locale,
    t,
    template,
    globals,
    date(value, options) {
      const id = JSON.stringify(options)
      let format = dates.get(id)
      if (!format) {
        format = new Intl.DateTimeFormat(locale, options)
        dates.set(id, format)
      }
      return format.format(value)
    },
    list: (items) => lists.format(items),
    relative(then, now) {
      const age = Math.max(0, now.getTime() - then.getTime())
      if (age < MINUTE) return t('time.just_now')
      if (age < HOUR) return t('time.minutes_ago', { count: Math.floor(age / MINUTE) })
      if (age < DAY) return t('time.hours_ago', { count: Math.floor(age / HOUR) })
      return t('time.days_ago', { count: Math.floor(age / DAY) })
    },
    distance(meters) {
      if (meters < 1000) return metres.format(Math.round(meters / 10) * 10)
      return kilometres.format(meters / 1000)
    },
  }
}
