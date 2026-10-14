import { DEFAULT_LOCALE, isLocale, loadMessages } from '@i18n/locales'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

// The language is the URL's first segment, and Spanish has none (docs/eng/frontend.md · Languages):
// `/c/7K3PQ` is Spanish and `/en/c/7K3PQ` English. Every screen hangs from here.
export const Route = createFileRoute('/{-$locale}')({
  beforeLoad: async ({ params, location }) => {
    const { locale } = params
    if (locale === undefined) return
    if (!isLocale(locale)) throw notFound()
    // One address per page: `/es/…` is the same page as `/…`.
    if (locale === DEFAULT_LOCALE) {
      throw redirect({
        href: location.href.replace(/^\/es(?=\/|\?|#|$)/, '') || '/',
        replace: true,
      })
    }
    // The page paints in its language at once, not in Spanish first.
    await loadMessages(locale)
  },
})
