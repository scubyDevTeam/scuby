// How a help request reads, in the page's language. Strings come from the `help` namespace.
import type { HelpCase, HelpNeed } from '@contracts/help-case'
import type { Translator } from '@i18n/translate'

/** The status strip: «NECESITA AYUDA», «YA TIENE AYUDA»… in the help colour. */
export function bandFor(i18n: Translator, request: HelpCase) {
  const className = request.status === 'active' ? 'bg-help' : 'bg-muted'
  return { label: i18n.t(`help.band.${request.status}`), className }
}

/**
 * «1 de 1 confirmado · 0 prometido»: confirmed first, promised second, never one self-reported
 * number (docs/product/07 · `help_pledge`).
 */
export function needProgressLine(i18n: Translator, need: HelpNeed): string {
  const { confirmed, pledged, target } = need
  if (confirmed === 0 && pledged === 0) return i18n.t('help.need.nobody_yet')
  return target === null
    ? i18n.t('help.need.progress_open', { confirmed, pledged })
    : i18n.t('help.need.progress_target', { confirmed, target, pledged })
}

/** «Para el 16 de octubre»: a date that matters, on the calendar it was given in. */
export function neededByLine(i18n: Translator, day: string): string {
  const date = i18n.date(new Date(`${day}T12:00:00Z`), {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  return i18n.t('help.need.needed_by', { date })
}

/** «Hogar temporal y transporte» — what is still asked, for the poster and the share message. */
export function openNeedsLine(i18n: Translator, request: HelpCase): string {
  const kinds = request.needs
    .filter((need) => need.status === 'open')
    .map((need) => i18n.t(`help.need.kind.${need.kind}`))
  return new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(kinds)
}
