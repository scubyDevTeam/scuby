import type { FoundCase } from '@contracts/found'
import {
  availableActions,
  type FoundAction,
  hasPossibleOwner,
  pageMode,
} from '@domain/found/actions'
import { publicArea } from '@domain/shared/geo'
import { formatRelative } from '@domain/shared/time'
import { CaseShell } from '@features/case/CaseShell'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import { Archive, Clock, Flag, Home, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { closedBand, describeFound, holdingLabel } from './copy'

const dayMonth = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' })

type Props = {
  foundCase: FoundCase
  now: Date
  shortUrl: string
  backLink: ReactNode
  mapStyleUrl: string | undefined
  onAction: (action: FoundAction) => void
  /** The custodian's tools: claims to answer and the hold-clock offer. */
  custodianPanel: ReactNode
}

export function FoundCasePage({
  foundCase,
  now,
  shortUrl,
  backLink,
  mapStyleUrl,
  onAction,
  custodianPanel,
}: Props) {
  const { pet, found } = foundCase
  const state = { status: foundCase.status, resolvedAt: foundCase.resolvedAt }
  const mode = pageMode(state)
  const actions = availableActions(state, foundCase.viewer, now)
  const can = (action: FoundAction) => actions.includes(action)
  const title = describeFound(pet)
  // The floor matters more here than in lost: the custodian's home is where the animal is now.
  const area = publicArea({ center: found.center, radiusM: found.radiusM })
  const band =
    foundCase.status === 'active'
      ? { label: 'Se encontró', className: 'bg-found' }
      : foundCase.status === 'expired'
        ? { label: 'Aviso archivado', className: 'bg-muted' }
        : {
            label: closedBand[foundCase.status],
            className: foundCase.status === 'cancelled' ? 'bg-muted' : 'bg-found',
          }

  return (
    <CaseShell
      band={band}
      shortUrl={shortUrl}
      photoUrls={pet.photoUrls}
      photoAlt={`Foto de ${title.toLowerCase()}`}
      backLink={backLink}
      onShare={can('share') ? () => onAction('share') : undefined}
      aside={
        <>
          {pet.marks ? (
            <section>
              <h2 className="m-0 text-2xl font-extrabold">Cómo es</h2>
              <p className="m-0 mt-2 text-lg">{pet.marks}</p>
            </section>
          ) : null}

          {can('contact_custodian') && foundCase.contact ? (
            <section className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="m-0 font-bold">{foundCase.contact.displayName}</p>
                <p className="m-0 text-muted">Lo encontró y lo cuida</p>
              </div>
              {foundCase.contact.whatsappUrl ? (
                <a
                  href={foundCase.contact.whatsappUrl}
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
        <h1 className="m-0 text-4xl font-extrabold lg:text-5xl">{title}</h1>
        <p className="m-0 mt-1 text-muted">
          Se encontró en {found.placeName} · {dayMonth.format(found.at)} ·{' '}
          {formatRelative(found.at, now)}
        </p>
        {mode === 'open' ? (
          <p className="m-0 mt-2 flex items-center gap-2">
            <Home aria-hidden="true" className="size-5 shrink-0" />
            {holdingLabel[foundCase.holdingWhere]}
          </p>
        ) : null}
      </section>

      {mode === 'closed' && foundCase.status !== 'cancelled' ? (
        <Notice tone="success" title={`${closedBand[foundCase.status as 'reunited']}.`}>
          Gracias a quien lo cuidó.
        </Notice>
      ) : null}
      {foundCase.status === 'cancelled' ? (
        <Notice tone="neutral" title="Este aviso fue cerrado.">
          Quien lo publicó lo retiró.
        </Notice>
      ) : null}
      {mode === 'archived' ? (
        <Notice
          tone="neutral"
          icon={<Archive aria-hidden="true" />}
          title="Este aviso fue archivado."
        >
          {can('reopen')
            ? 'Puedes reactivarlo si sigues con él.'
            : 'Quien lo publicó puede reactivarlo.'}
        </Notice>
      ) : null}

      {can('claim_ownership') ? (
        <Button
          hint="Te pediremos entrar con tu cuenta"
          onClick={() => onAction('claim_ownership')}
        >
          Es mío
        </Button>
      ) : null}
      {can('reopen') ? <Button onClick={() => onAction('reopen')}>Reactivar aviso</Button> : null}

      {can('confirm_reunited') ? (
        <section className="flex flex-col gap-3">
          <Button onClick={() => onAction('confirm_reunited')}>Ya está con su dueño</Button>
          <div className="flex flex-col gap-3 lg:flex-row">
            <Button variant="outline" onClick={() => onAction('keep')}>
              Me lo quedo
            </Button>
            <Button variant="outline" onClick={() => onAction('transfer_to_org')}>
              Lo entregué a una fundación
            </Button>
          </div>
          <Button variant="link" className="text-lost-deep" onClick={() => onAction('cancel')}>
            Eliminar aviso
          </Button>
        </section>
      ) : null}

      {custodianPanel}

      {mode === 'open' &&
      foundCase.viewer === 'public' &&
      hasPossibleOwner(foundCase.openClaimCount) ? (
        <Notice icon={<Clock aria-hidden="true" />} title="Posible dueño.">
          Alguien dice que es suyo y quien lo cuida lo está verificando.
        </Notice>
      ) : null}

      {mode === 'open' ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-2xl font-extrabold">Dónde se encontró</h2>
          <CaseMap
            styleUrl={mapStyleUrl}
            area={area}
            areaLabel="Zona donde se encontró (aproximada)"
            pins={[]}
          />
        </section>
      ) : null}
    </CaseShell>
  )
}
