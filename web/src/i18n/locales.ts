// The languages the app speaks (docs/eng/frontend.md · Languages). The language is a segment of the
// URL — `/en/c/7K3PQ` — and Spanish, the source, has none: `/c/7K3PQ`, so every printed poster and
// every link already shared keeps working. A new language is one JSON file and one entry here.
import esCore from 'virtual:messages/core/es'
import { loaders } from 'virtual:messages/loaders'
import type { DeferredNamespace } from './namespaces'

export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE = 'es' satisfies Locale

/** The shape every language file has: Spanish is the source, the others translate it key by key. */
export type Messages = typeof import('./locales/es.json')

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale)

/** The URL segment for a language: none for the default one. */
export const localeSegment = (locale: Locale): Locale | undefined =>
  locale === DEFAULT_LOCALE ? undefined : locale

// Each language file arrives in parts (vite.config.ts · localeNamespaces): `core` — what a case
// page, the feed and the chrome say — and one part per deferred namespace, fetched with the screen
// that uses it. Spanish `core` ships in the bundle: it is the first paint for almost everyone.
type Part = 'core' | DeferredNamespace

// One object per language, filled in place as parts arrive; `version` tells React when.
const loaded = new Map<Locale, Record<string, unknown>>([[DEFAULT_LOCALE, { ...esCore }]])
let version = 0
const arrived = new Set<string>([`${DEFAULT_LOCALE}/core`])
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function loadPart(locale: Locale, part: Part): Promise<void> {
  const id = `${locale}/${part}`
  if (arrived.has(id)) return Promise.resolve()
  let request = pending.get(id)
  if (!request) {
    const load = loaders[locale]?.[part]
    if (!load) return Promise.resolve()
    request = load().then(({ default: messages }) => {
      loaded.set(locale, Object.assign(loaded.get(locale) ?? {}, messages))
      version += 1
      arrived.add(id)
      pending.delete(id)
      for (const listener of listeners) listener()
    })
    pending.set(id, request)
  }
  return request
}

/**
 * The words a screen needs, in `locale` and in the source language it falls back to. Routes call it
 * before they render; lazy sheets get it with their chunk (`withMessages`).
 */
export async function loadMessages(
  locale: Locale,
  namespaces: readonly DeferredNamespace[] = [],
): Promise<void> {
  const locales: Locale[] = locale === DEFAULT_LOCALE ? [locale] : [locale, DEFAULT_LOCALE]
  await Promise.all(
    locales.flatMap((each) => [
      loadPart(each, 'core'),
      ...namespaces.map((ns) => loadPart(each, ns)),
    ]),
  )
}

/** The messages of a language that are here so far; never blank — the source fills the gaps. */
export const messagesFor = (locale: Locale): Messages =>
  (loaded.get(locale) ?? loaded.get(DEFAULT_LOCALE)) as Messages

/** Changes every time a part of any language arrives. */
export const messagesVersion = () => version

export function onMessagesLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The language on screen, for a lazy chunk that has no route to read it from.
let active: Locale = DEFAULT_LOCALE
export const setActiveLocale = (locale: Locale) => {
  active = locale
}

/** A lazy import that also brings the words it needs: `lazy(withMessages(['reporting'], () => …))`. */
export function withMessages<T>(
  namespaces: readonly DeferredNamespace[],
  load: () => Promise<T>,
): () => Promise<T> {
  return () => Promise.all([load(), loadMessages(active, namespaces)]).then(([module]) => module)
}
