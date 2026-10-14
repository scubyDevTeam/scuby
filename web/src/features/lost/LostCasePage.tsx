import type { LostCase } from '@contracts/case'
import { availableActions, hasPossibleFind, type LostAction, pageMode } from '@domain/lost/actions'
import { placeSightings } from '@domain/lost/sightings'
import { publicArea } from '@domain/shared/geo'
import { formatRelative } from '@domain/shared/time'
import { CaseShell } from '@features/case/CaseShell'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import { Archive, Clock, Flag, PartyPopper, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
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

  const band =
    mode === 'open'
      ? { label: 'Se busca', className: 'bg-lost' }
      : lostCase.status === 'reunited'
        ? { label: 'Ya está en casa', className: 'bg-found' }
        : {
            label: mode === 'archived' ? 'Aviso archivado' : 'Aviso cerrado',
            className: 'bg-muted',
          }

  return (
    <CaseShell
      band={band}
      shortUrl={shortUrl}
      photoUrls={pet.photoUrls}
      photoAlt={`Foto de ${pet.name}`}
      backLink={backLink}
      onShare={can('share') ? () => onAction('share') : undefined}
      aside={
        <>
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
        </>
      }
    >
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
      {can('reopen') ? <Button onClick={() => onAction('reopen')}>Reactivar aviso</Button> : null}

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
          Alguien dice que la tiene y su familia lo está verificando. La búsqueda sigue: si la ves,
          repórtalo.
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
    </CaseShell>
  )
}
