// The languages the app speaks (docs/eng/frontend.md · Languages). The language is a segment of the
// URL — `/en/c/7K3PQ` — and Spanish, the source, has none: `/c/7K3PQ`, so every printed poster and
// every link already shared keeps working. A new language is one JSON file and one entry here.
import es from './locales/es.json'

export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE = 'es' satisfies Locale

/** The shape every language file has: Spanish is the source, the others translate it key by key. */
export type Messages = typeof es

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale)

/** The URL segment for a language: none for the default one. */
export const localeSegment = (locale: Locale): Locale | undefined =>
  locale === DEFAULT_LOCALE ? undefined : locale

// Spanish ships in the bundle — it is the first paint for almost everyone. The others are a chunk
// each, fetched once when a URL asks for them.
const loaders: Record<
  Exclude<Locale, typeof DEFAULT_LOCALE>,
  () => Promise<{ default: Messages }>
> = {
  en: () => import('./locales/en.json'),
}

const loaded = new Map<Locale, Messages>([[DEFAULT_LOCALE, es]])
const listeners = new Set<() => void>()

export function loadMessages(locale: Locale): Promise<Messages> {
  const ready = loaded.get(locale)
  if (ready) return Promise.resolve(ready)
  if (locale === DEFAULT_LOCALE) return Promise.resolve(es)
  return loaders[locale]().then(({ default: messages }) => {
    loaded.set(locale, messages)
    for (const listener of listeners) listener()
    return messages
  })
}

/** The messages for a language if they are already here; the source language otherwise. */
export const messagesFor = (locale: Locale): Messages => loaded.get(locale) ?? es

export function onMessagesLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
