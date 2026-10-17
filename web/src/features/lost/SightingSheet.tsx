import { useDeleteSighting } from '@api-client/sighting-edit'
import type { Sighting } from '@contracts/case'
import type { PlacedSighting } from '@domain/lost/sightings'
import { canEditOwn } from '@domain/lost/sightings'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Sheet } from '@ui/Sheet'
import { Phone } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { formatSeenAt } from './copy'

// The owner's hide / highlight: the timeline's own tools, loaded for the owner only.
const SightingTools = lazy(() =>
  import('./SightingModeration').then((m) => ({ default: m.SightingTools })),
)

type Props = {
  code: string
  sighting: PlacedSighting<Sighting>
  now: Date
  isOwner: boolean
  onClose: () => void
  /** «La vi aquí también»: anyone but the owner, while the case is open. */
  onSawItToo?: () => void
  /** «Corregir el punto»: the reporter's own pin, while its window is open. */
  onCorrect?: () => void
}

/**
 * A sighting pin's sheet (docs/product/04 · Display rules 3; design «Mapa · ficha del pin»): when,
 * as absolute and relative, how far from where it was lost, who reported it, photo and note. The
 * owner also gets the reporter's number — the server sends `contact_phone` to the owner alone — and
 * their tools. Lazy, with its words: only a tap on a pin pays for it.
 */
export function SightingSheet({
  code,
  sighting,
  now,
  isOwner,
  onClose,
  onSawItToo,
  onCorrect,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const phone = sighting.contactPhone
  const photo = sighting.photoUrls[0]

  return (
    <Sheet open onClose={onClose} title={t('map_sheet.sighting.title', { n: sighting.order })}>
      <div className="flex items-start gap-4">
        {photo ? (
          <img
            src={photo}
            alt={t('map_sheet.sighting.photo_alt')}
            className="size-28 shrink-0 rounded-2xl object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xl font-extrabold">{formatSeenAt(i18n, sighting.seenAt, now)}</p>
          <p className="m-0 text-muted">
            {i18n.relative(sighting.seenAt, now)} ·{' '}
            {t('map_sheet.sighting.distance', {
              distance: i18n.distance(sighting.distanceFromLastSeenM),
            })}
          </p>
          <p className="m-0 text-sm text-muted">
            {t(
              sighting.source === 'registered'
                ? 'map_sheet.sighting.by_registered'
                : 'map_sheet.sighting.by_anonymous',
            )}
          </p>
        </div>
      </div>
      {sighting.note ? (
        <p className="m-0 text-lg">{t('lost.timeline.note', { note: sighting.note })}</p>
      ) : null}
      {phone ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 font-bold">{phone}</p>
          <div className="flex gap-2">
            <a
              href={`https://wa.me/${phone.replace('+', '')}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClass('whatsapp')}
            >
              <WhatsAppIcon />
              {t('map_sheet.sighting.write')}
            </a>
            <a href={`tel:${phone}`} className={buttonClass('secondary')}>
              <Phone aria-hidden="true" />
              {t('map_sheet.sighting.call')}
            </a>
          </div>
        </div>
      ) : null}
      {canEditOwn(sighting, now) && sighting.editableUntil ? (
        <OwnTools
          code={code}
          id={sighting.id}
          until={sighting.editableUntil}
          onCorrect={onCorrect}
          onDeleted={onClose}
        />
      ) : null}
      {isOwner ? (
        <Suspense fallback={null}>
          <SightingTools code={code} sighting={sighting} />
        </Suspense>
      ) : null}
      {onSawItToo ? (
        <Button
          onClick={() => {
            onClose()
            onSawItToo()
          }}
        >
          {t('map_sheet.sighting.saw_it_too')}
        </Button>
      ) : null}
    </Sheet>
  )
}

/** Your own pin, inside its fifteen minutes: move it or take it back (04 · Correction window). */
function OwnTools({
  code,
  id,
  until,
  onCorrect,
  onDeleted,
}: {
  code: string
  id: string
  until: Date
  onCorrect?: () => void
  onDeleted: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const remove = useDeleteSighting(code)
  const [sure, setSure] = useState(false)
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-brand-mist p-4">
      <p className="m-0">
        {t('map_sheet.sighting.yours', {
          time: i18n.date(until, { hour: 'numeric', minute: '2-digit', hour12: true }),
        })}
      </p>
      {remove.isError ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('map_sheet.sighting.delete_failed')}
        </p>
      ) : null}
      {sure ? (
        <>
          <p className="m-0 font-bold">{t('map_sheet.sighting.delete_confirm')}</p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(id, { onSuccess: onDeleted })}
            >
              {t(
                remove.isPending ? 'map_sheet.sighting.deleting' : 'map_sheet.sighting.delete_yes',
              )}
            </Button>
            <Button variant="outline" onClick={() => setSure(false)}>
              {t('map_sheet.sighting.delete_no')}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          {onCorrect ? (
            <Button variant="secondary" onClick={onCorrect}>
              {t('map_sheet.sighting.correct')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setSure(true)}>
            {t('map_sheet.sighting.delete')}
          </Button>
        </div>
      )}
    </section>
  )
}
