// What the poster and the pre-written message say (docs/product/10 §3–4). The words live in the
// `sharing` namespace of src/i18n/locales — an adoption listing's in `adoption.poster` — and this
// turns a case into them, in the page's language.
import type { AdoptionCase } from '@contracts/adoption'
import type { LostCase } from '@contracts/case'
import type { FoundCase } from '@contracts/found'
import { type PosterFormat, posterFooter } from '@domain/shared/poster'
import { feeLine } from '@features/adoption/copy'
import { describeFound } from '@features/found/copy'
import { describePet, formatDayMonth } from '@features/lost/copy'
import type { Translator } from '@i18n/translate'

/** The case's short link: the full URL the QR encodes, and how it reads printed. */
export type ShortLink = { url: string; display: string }

export type PosterCase = LostCase | FoundCase | AdoptionCase

/** The owner, custodian or lister — whoever is responsible — frames the photo and gets the tip. */
export const isResponsible = (posterCase: PosterCase) => posterCase.viewer !== 'public'

export type PosterContent = {
  vertical: PosterCase['vertical']
  code: string
  /** «SE BUSCA», already in capitals. */
  label: string
  /** The pet's name; a found animal has none and is titled by what it looks like. */
  title: string
  traits: string
  /** «Se perdió en Laureles · 2 de octubre · hace 3 días» */
  line: string
  noPhoto: string
  scan: string
  link: ShortLink
  info: string
  footer: string | null
  photoUrl: string | null
}

/** Where and since when: the last-seen area, the found area, or where the listing lives. */
function where(posterCase: PosterCase): { placeName: string; at: Date } {
  if (posterCase.vertical === 'lost') return posterCase.lastSeen
  if (posterCase.vertical === 'found') return posterCase.found
  return { placeName: posterCase.location.placeName, at: posterCase.publishedAt }
}

const titleOf = (i18n: Translator, posterCase: PosterCase) =>
  posterCase.vertical === 'found' ? describeFound(i18n, posterCase.pet) : posterCase.pet.name

/** «EN ADOPCIÓN», «SE BUSCA»: the label band, in capitals. */
const labelOf = (i18n: Translator, posterCase: PosterCase) =>
  (posterCase.vertical === 'adoption'
    ? i18n.t('adoption.poster.label')
    : i18n.t(`sharing.label.${posterCase.vertical}`)
  ).toLocaleUpperCase(i18n.locale)

/** The tip under the poster for whoever is responsible for the case. */
export const ownerHint = (i18n: Translator, posterCase: PosterCase) =>
  posterCase.vertical === 'adoption'
    ? i18n.t('adoption.poster.owner_hint')
    : i18n.t(`sharing.owner_hint.${posterCase.vertical}`)

export function posterContent(
  i18n: Translator,
  posterCase: PosterCase,
  link: ShortLink,
  now: Date,
): PosterContent {
  const { t } = i18n
  const { placeName, at } = where(posterCase)
  const footer = posterFooter(posterCase.vertical)
  return {
    vertical: posterCase.vertical,
    code: posterCase.code,
    label: labelOf(i18n, posterCase),
    title: titleOf(i18n, posterCase),
    traits: describePet(i18n, posterCase.pet),
    line:
      posterCase.vertical === 'adoption'
        ? t('adoption.poster.line', { place: placeName, date: formatDayMonth(i18n, at) })
        : t(`sharing.line.${posterCase.vertical}`, {
            place: placeName,
            date: formatDayMonth(i18n, at),
            ago: i18n.relative(at, now),
          }),
    noPhoto: t('sharing.no_photo'),
    scan: t('sharing.scan').toLocaleUpperCase(i18n.locale),
    link,
    info: t('sharing.info'),
    footer: footer && t(`sharing.footer.${footer}`),
    photoUrl: posterCase.pet.photoUrls[0] ?? null,
  }
}

/** docs/product/10 §4 · the pre-written message, always ending in the short link. */
export function shareMessage(i18n: Translator, posterCase: PosterCase, link: ShortLink): string {
  const { placeName, at } = where(posterCase)
  if (posterCase.vertical === 'adoption') {
    return i18n.t('adoption.poster.message', {
      label: labelOf(i18n, posterCase),
      title: titleOf(i18n, posterCase),
      place: placeName,
      traits: describePet(i18n, posterCase.pet),
      fee: feeLine(i18n, posterCase.fee),
      link: link.url,
    })
  }
  return i18n.t(`sharing.message.${posterCase.vertical}`, {
    label: labelOf(i18n, posterCase),
    title: titleOf(i18n, posterCase),
    place: placeName,
    traits: describePet(i18n, posterCase.pet),
    date: formatDayMonth(i18n, at),
    link: link.url,
  })
}

/** Text only: the link preview carries the image. */
export const whatsappShareUrl = (message: string) =>
  `https://wa.me/?text=${encodeURIComponent(message)}`

/** `7K3PQ-story.png` · `7K3PQ-print.pdf` — the code, never the product name. */
export const posterFileName = (code: string, format: PosterFormat) =>
  `${code}-${format}.${format === 'print' ? 'pdf' : 'png'}`
