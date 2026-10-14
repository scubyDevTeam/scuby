import type { LostCase } from '@contracts/case'
import { availableActions, hasPossibleFind, type LostAction, pageMode } from '@domain/lost/actions'
import { placeSightings } from '@domain/lost/sightings'
import { publicArea } from '@domain/shared/geo'
import { formatRelative } from '@domain/shared/time'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass, roundButtonClass } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import { Archive, Clock, Flag, PartyPopper, Share2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ClaimsList } from './ClaimsList'
import { describePet, formatDayMonth, sightingsCount } from './copy'
import { SightingTimeline } from './SightingTimeline'

type Props = {
  lostCase: LostCase
  now: Date
  /** Host and code as printed on the band — the address people type from a poster. */
  shortUrl: string
  backLink: ReactNode
  /** Tile style for the map; undefined draws the area and pins without streets. */
  mapStyleUrl: string | undefined
  onAction: (action: LostAction) => void
}

export function LostCasePage({ lostCase, now, shortUrl, backLink, mapStyleUrl, onAction }: Props) {
  const { pet, lastSeen } = lostCase
  const state = { status: lostCase.status, resolvedAt: lostCase.resolvedAt }
  const mode = pageMode(state)
  const actions = availableActions(state, lostCase.viewer, now)
  const can = (action: LostAction) => actions.includes(action)
  // The owner sees the circle they drew; everyone else sees it floored at 200 m.
  const area =
    lostCase.viewer === 'owner'
      ? { center: lastSeen.center, radiusM: lastSeen.radiusM }
      : publicArea({ center: lastSeen.center, radiusM: lastSeen.radiusM })
  const sightings = placeSightings(lostCase.sightings, lastSeen.center, now)

  return (
    <article className="mx-auto flex max-w-lg flex-col pb-10 lg:max-w-none">
      <StatusBand mode={mode} status={lostCase.status} shortUrl={shortUrl} />

      {/* Phone: one column — photo, band, story, details. Desktop: photo and details left, story right. */}
      <div className="contents lg:order-2 lg:mx-auto lg:grid lg:w-full lg:max-w-6xl lg:grid-cols-[5fr_6fr] lg:items-start lg:gap-x-12 lg:px-8 lg:pt-10">
        <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-8">
          <header className="relative order-1">
            <Gallery urls={pet.photoUrls} name={pet.name} />
            <div className="absolute inset-x-4 top-4 flex justify-between lg:hidden">
              {backLink}
              {can('share') ? (
                <RoundButton label="Compartir" onClick={() => onAction('share')}>
                  <Share2 aria-hidden="true" />
                </RoundButton>
              ) : null}
            </div>
          </header>

          <div className="order-4 flex flex-col gap-6 px-5 pt-6 lg:px-0 lg:pt-0">
            {pet.marks ? (
              <section>
                <h2 className="m-0 text-2xl font-extrabold">Señas</h2>
                <p className="m-0 mt-2 text-lg">{pet.marks}</p>
              </section>
            ) : null}

            {can('contact_owner') && lostCase.contact ? (
              <section className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="m-0 font-bold">{lostCase.contact.displayName}</p>
                  <p className="m-0 text-muted">Su familia</p>
                </div>
                {lostCase.contact.whatsappUrl ? (
                  <a
                    href={lostCase.contact.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass('whatsapp', 'lg:w-auto')}
                  >
                    <WhatsAppIcon />
                    Escribirle por WhatsApp
                  </a>
                ) : null}
              </section>
            ) : null}

            {can('share') || can('report_content') ? (
              <footer className="flex flex-wrap items-center justify-between gap-2">
                {can('share') ? (
                  <Button variant="link" onClick={() => onAction('share')}>
                    <Share2 aria-hidden="true" />
                    Compartir aviso
                  </Button>
                ) : null}
                {can('report_content') ? (
                  <Button
                    variant="link"
                    className="font-normal text-muted"
                    onClick={() => onAction('report_content')}
                  >
                    <Flag aria-hidden="true" className="size-4" />
                    Reportar
                  </Button>
                ) : null}
              </footer>
            ) : null}
          </div>
        </div>

        <div className="order-3 flex flex-col gap-6 px-5 pt-5 lg:col-start-2 lg:row-start-1 lg:px-0 lg:pt-0">
          <section>
            <h1 className="m-0 text-4xl font-extrabold lg:text-6xl">{pet.name}</h1>
            <p className="m-0 mt-1 text-lg lg:text-xl">{describePet(pet)}</p>
            <p className="m-0 mt-1 text-muted">
              Se perdió en {lastSeen.placeName} · {formatDayMonth(lastSeen.at)} ·{' '}
              {formatRelative(lastSeen.at, now)}
            </p>
          </section>

          {mode === 'closed' && lostCase.status === 'reunited' ? (
            <Notice
              tone="success"
              icon={<PartyPopper aria-hidden="true" />}
              title={`¡${pet.name} ya está en casa!`}
            >
              Gracias a quienes ayudaron a buscar.
            </Notice>
          ) : null}
          {mode === 'closed' && lostCase.status === 'cancelled' ? (
            <Notice tone="neutral" title="Este aviso fue cerrado.">
              Su familia lo retiró; ya no hace falta buscar.
            </Notice>
          ) : null}
          {mode === 'archived' ? (
            <Notice
              tone="neutral"
              icon={<Archive aria-hidden="true" />}
              title="Este aviso fue archivado."
            >
              {can('reopen')
                ? 'Puedes reactivarlo y conservar sus avistamientos.'
                : 'Su familia puede reactivarlo si la búsqueda sigue.'}
            </Notice>
          ) : null}

          {can('report_sighting') || can('claim_recovery') ? (
            <section className="flex flex-col gap-3 lg:flex-row">
              {can('report_sighting') ? (
                <Button hint="Marca dónde · sin cuenta" onClick={() => onAction('report_sighting')}>
                  La vi
                </Button>
              ) : null}
              {can('claim_recovery') ? (
                <Button variant="outline" onClick={() => onAction('claim_recovery')}>
                  La tengo conmigo
                </Button>
              ) : null}
            </section>
          ) : null}
          {can('confirm_reunited') ? (
            <section className="flex flex-col gap-3">
              <Button onClick={() => onAction('confirm_reunited')}>Ya apareció</Button>
              <Button variant="link" className="text-lost-deep" onClick={() => onAction('cancel')}>
                Eliminar aviso
              </Button>
            </section>
          ) : null}
          {can('reopen') ? (
            <Button onClick={() => onAction('reopen')}>Reactivar aviso</Button>
          ) : null}

          {lostCase.viewer === 'owner' && mode === 'open' ? (
            <ClaimsList
              code={lostCase.code}
              petName={pet.name}
              claims={lostCase.claims}
              now={now}
              revealsOwnNumber={lostCase.contact?.whatsappUrl == null}
              onConfirmed={() => onAction('confirm_reunited')}
            />
          ) : null}

          {mode === 'open' &&
          lostCase.viewer === 'public' &&
          hasPossibleFind(lostCase.openClaimCount) ? (
            <Notice icon={<Clock aria-hidden="true" />} title="Posible hallazgo.">
              Alguien dice que la tiene y su familia lo está verificando. La búsqueda sigue: si la
              ves, repórtalo.
            </Notice>
          ) : null}

          {mode === 'open' ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="m-0 text-2xl font-extrabold">Por dónde va</h2>
                <span className="text-muted">{sightingsCount(sightings.length)}</span>
              </div>
              <CaseMap
                styleUrl={mapStyleUrl}
                area={area}
                areaLabel="Zona donde se perdió (aproximada)"
                pins={sightings.map((s) => ({
                  id: s.id,
                  point: s.point,
                  order: s.order,
                  band: s.band,
                  emphasized: s.emphasized,
                  label: s.isLatest ? formatRelative(s.seenAt, now) : undefined,
                }))}
              />
              {sightings.length > 0 ? (
                <SightingTimeline sightings={sightings} now={now} />
              ) : (
                <p className="m-0 text-muted">
                  Nadie la ha visto todavía. Si la ves, márcalo en el mapa.
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function Gallery({ urls, name }: { urls: readonly string[]; name: string }) {
  const [selected, setSelected] = useState(0)
  const current = urls[selected] ?? urls[0]
  if (!current) return <div className="aspect-square w-full bg-soft lg:rounded-3xl" />
  const photo = (
    <img
      src={current}
      alt={`Foto de ${name}`}
      className="aspect-square w-full object-cover lg:rounded-3xl"
    />
  )
  if (urls.length === 1) return photo

  return (
    <div className="flex flex-col gap-3">
      {/* On a phone the photo itself is the control; a desktop has room for thumbnails. */}
      <button
        type="button"
        aria-label="Ver la siguiente foto"
        onClick={() => setSelected((selected + 1) % urls.length)}
        className="relative block w-full border-0 bg-transparent p-0"
      >
        {photo}
        <span className="absolute right-4 bottom-4 rounded-full bg-ink/80 px-3 py-1 text-sm font-bold text-white">
          {selected + 1} / {urls.length}
        </span>
      </button>
      <ul className="m-0 hidden list-none grid-cols-4 gap-2 p-0 lg:grid">
        {urls.map((url, index) => (
          <li key={url}>
            <button
              type="button"
              aria-label={`Ver foto ${index + 1}`}
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
              className={`block w-full overflow-hidden rounded-xl border-4 p-0 ${
                index === selected ? 'border-brand' : 'border-transparent'
              }`}
            >
              <img src={url} alt="" className="aspect-4/3 w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusBand({
  mode,
  status,
  shortUrl,
}: {
  mode: ReturnType<typeof pageMode>
  status: LostCase['status']
  shortUrl: string
}) {
  const band =
    mode === 'open'
      ? { label: 'Se busca', className: 'bg-lost' }
      : status === 'reunited'
        ? { label: 'Ya está en casa', className: 'bg-found' }
        : {
            label: mode === 'archived' ? 'Aviso archivado' : 'Aviso cerrado',
            className: 'bg-muted',
          }
  return (
    <div
      className={`order-2 flex items-center justify-between gap-3 px-5 py-3 text-white lg:order-1 lg:px-[max(2rem,calc((100vw-72rem)/2+2rem))] ${band.className}`}
    >
      <strong className="text-lg tracking-widest uppercase">{band.label}</strong>
      <span className="font-mono text-sm font-bold">{shortUrl}</span>
    </div>
  )
}

function RoundButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={roundButtonClass}>
      {children}
    </button>
  )
}
