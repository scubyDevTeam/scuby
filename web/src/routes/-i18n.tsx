// The language of the whole app comes from the URL (docs/eng/frontend.md · Languages). Mounted by
// the router itself (main.tsx · InnerWrap), so the not-found page speaks it too.
import { setRequestLanguage } from '@api-client/http'
import { queryClient } from '@api-client/query-client'
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  type Locale,
  loadMessages,
  localeSegment,
} from '@i18n/locales'
import type { DeferredNamespace } from '@i18n/namespaces'
import { I18nProvider, useI18n } from '@i18n/react'
import { Link, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { brand } from '../brand'

/**
 * A route's `beforeLoad` that brings the words its screen needs, in the URL's language:
 * `beforeLoad: needsWords('publish')`.
 */
export const needsWords =
  (...namespaces: DeferredNamespace[]) =>
  ({ params }: { params: { locale?: string } }) =>
    loadMessages(isLocale(params.locale) ? params.locale : DEFAULT_LOCALE, namespaces)

export function useLocale(): Locale {
  const segment = useRouterState({
    select: (state) => (state.matches.at(-1)?.params as { locale?: string } | undefined)?.locale,
  })
  return isLocale(segment) ? segment : DEFAULT_LOCALE
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const globals = useMemo(() => ({ brand: brand.name }), [])
  const previous = useRef(locale)

  setRequestLanguage(locale)
  useEffect(() => {
    if (previous.current === locale) return
    previous.current = locale
    // What the server composed for display (place names, summaries) came in the other language.
    void queryClient.invalidateQueries()
  }, [locale])

  return (
    <I18nProvider locale={locale} globals={globals}>
      {children}
    </I18nProvider>
  )
}

/** The same page in each of the other languages, named in its own language. */
export function LanguageLinks({ className }: { className: string }) {
  const { t, locale } = useI18n()
  const others = LOCALES.filter((other) => other !== locale)
  return (
    <nav aria-label={t('common.language')} className="flex gap-2">
      {others.map((other) => (
        <Link
          key={other}
          to="."
          params={(current) => ({ ...current, locale: localeSegment(other) })}
          hrefLang={other}
          lang={other}
          className={className}
        >
          {nameOf(other)}
        </Link>
      ))}
    </nav>
  )
}

/** «Español», «English»: each language by its own name, so whoever needs it can read it. */
function nameOf(locale: Locale): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}
