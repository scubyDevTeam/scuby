// UI copy helpers for the adoption listing: they turn domain values into words. The rules live in
// src/domain/adoption; the words in the `adoption` and `adoption_forms` namespaces.
import type { AdoptionCase, Intro } from '@contracts/adoption'
import type { Translator } from '@i18n/translate'

/** The band: status first (10 §1), «En proceso» while someone is chosen. */
export function bandFor(i18n: Translator, listing: Pick<AdoptionCase, 'status' | 'reserved'>) {
  const { t } = i18n
  if (listing.status === 'active') {
    return listing.reserved
      ? { label: t('adoption.band.reserved'), className: 'bg-adoption' }
      : { label: t('adoption.band.active'), className: 'bg-adoption' }
  }
  if (listing.status === 'adopted')
    return { label: t('adoption.band.adopted'), className: 'bg-found' }
  return {
    label: t(listing.status === 'expired' ? 'adoption.band.expired' : 'adoption.band.withdrawn'),
    className: 'bg-muted',
  }
}

const MONTH = 30 * 86_400_000

/** «miembro hace 8 meses» — a fact from the account, never a verdict (06). */
export function memberSince(i18n: Translator, since: Date, now: Date): string {
  const months = Math.floor((now.getTime() - since.getTime()) / MONTH)
  return months >= 1
    ? i18n.t('adoption_forms.lister.member_months', { count: months })
    : i18n.t('adoption_forms.lister.member', { ago: i18n.relative(since, now) })
}

/** The intro, ready to paste into WhatsApp: the adopter does not retype what they just wrote. */
export function introMessage(i18n: Translator, name: string, link: string, intro: Intro): string {
  const { t } = i18n
  const k = 'adoption_forms.interest.whatsapp'
  return [
    t(`${k}.greeting`, { name, link }),
    t(`${k}.home`, {
      housing: t(`${k}.housing.${intro.housing}`),
      yard: t(`${k}.yard.${intro.hasYard ? 'yes' : 'no'}`),
    }),
    intro.otherPets ? t(`${k}.other_pets`, { text: intro.otherPets }) : null,
    intro.household ? t(`${k}.household`, { text: intro.household }) : null,
    t(`${k}.why`, { text: intro.why }),
  ]
    .filter(Boolean)
    .join('\n')
}
