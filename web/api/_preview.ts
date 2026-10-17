// What a case's link preview says (docs/product/10 §2): the tag *content*, per vertical and status.
// The words live in the `preview` namespace of src/i18n/locales; share.ts only places them.
import type { caseWire } from '../src/contracts/case'
import { describeFound } from '../src/features/found/copy'
import { describePet } from '../src/features/lost/copy'
import type { Translator } from '../src/i18n/translate'

export type CaseWire = ReturnType<typeof caseWire.parse>

export type Preview = {
  title: string
  description: string
  image: { url: string; alt: string } | null
}

/**
 * «10 de febrero» on the calendar of the place: the day in the offset the API wrote the time with
 * (times are ISO 8601 with an offset — docs/eng/api.md), not in the server's own time zone.
 */
function dayOf(i18n: Translator, iso: string): string {
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(iso)
  const minutes = offset ? (offset[1] === '-' ? -1 : 1) * (+offset[2]! * 60 + +offset[3]!) : 0
  return i18n.date(new Date(Date.parse(iso) + minutes * 60_000), {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/**
 * The seam for O10 (docs/open-items.md): what renders the 1200×630 card is undecided. Until it is,
 * og:image is the case's first photo as the API sends it — the `card` variant
 * (docs/eng/media-pipeline.md §3). When the renderer lands, this returns its URL for the code.
 */
function previewImage(wire: CaseWire, origin: string): string | null {
  const photo = wire.pet.photo_urls[0]
  if (!photo) return null
  try {
    const url = new URL(photo, origin)
    // A crawler fetches it: an inline (data:) stand-in photo is no image to a crawler.
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const upper = (i18n: Translator, text: string) => text.toLocaleUpperCase(i18n.locale)

function words(i18n: Translator, wire: CaseWire) {
  const { t } = i18n
  if (wire.vertical === 'lost') {
    const label = t(`preview.label.lost.${wire.status}`)
    const description =
      wire.status === 'active'
        ? t('preview.description.lost_active', {
            traits: describePet(i18n, wire.pet),
            date: dayOf(i18n, wire.last_seen.at),
          })
        : t(`preview.description.lost_${wire.status}`, { name: wire.pet.name })
    return { label, name: wire.pet.name, place: wire.last_seen.place_name, description }
  }
  if (wire.vertical === 'found') {
    const label = t(`preview.label.found.${wire.status}`)
    const { status } = wire
    const description =
      status === 'active'
        ? t('preview.description.found_active', {
            traits: describePet(i18n, wire.pet),
            date: dayOf(i18n, wire.found.at),
          })
        : status === 'expired' || status === 'cancelled'
          ? t(`preview.description.found_${status}`)
          : t('preview.description.found_resolved', { status: label })
    const name = describeFound(i18n, { ...wire.pet, photoUrls: wire.pet.photo_urls })
    return { label, name, place: wire.found.place_name, description }
  }
  if (wire.vertical === 'adoption') {
    const label = t(`preview.label.adoption.${wire.status}`)
    const { name } = wire.pet
    const description =
      wire.status === 'active'
        ? t('preview.description.adoption_active', { traits: describePet(i18n, wire.pet) })
        : t(`preview.description.adoption_${wire.status}`, { name })
    return { label, name, place: wire.location.place_name, description }
  }
  // «YA TIENE AYUDA» only when every need was covered; any other ending says just that it ended.
  const covered = wire.status === 'closed' && wire.resolution === 'covered'
  const label = t(`preview.label.help.${covered ? 'covered' : wire.status}`)
  const { name } = wire.pet
  // What is still asked, named in the page's language: the needs are keys on the wire.
  const open = wire.needs
    .filter((need) => need.status === 'open')
    .map((need) => t(`preview.need.${need.kind}`))
  const needs =
    open.length > 1
      ? `${open.slice(0, -1).join(', ')}${t('preview.need.and')}${open.at(-1)}`
      : (open[0] ?? '')
  const ending =
    wire.status === 'active' || covered
      ? 'closed'
      : wire.status === 'closed'
        ? 'ended'
        : wire.status
  const description =
    wire.status === 'active' && needs
      ? t('preview.description.help_active', { name, needs })
      : t(`preview.description.help_${ending}`, { name })
  return { label, name, place: wire.location.place_name, description }
}

/** `SE BUSCA: Luna — Santa Ana`, the one-line description and the image, in the page's language. */
export function casePreview(i18n: Translator, wire: CaseWire, origin: string): Preview {
  const { label, name, place, description } = words(i18n, wire)
  const image = previewImage(wire, origin)
  return {
    title: i18n.t('preview.title', { label: upper(i18n, label), name, place }),
    description,
    image: image ? { url: image, alt: i18n.t('preview.image_alt', { name }) } : null,
  }
}

/** A purged case (410) or an unknown code (404): neutral words, no image — a poster never 404s. */
export function missingPreview(i18n: Translator, kind: 'gone' | 'not_found'): Preview {
  return {
    title: i18n.t(kind === 'gone' ? 'case.gone' : 'case.not_found'),
    description: i18n.t(kind === 'gone' ? 'preview.gone' : 'preview.not_found'),
    image: null,
  }
}
