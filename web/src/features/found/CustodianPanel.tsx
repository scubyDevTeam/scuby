import { useAnswerOwnershipClaim, useResolveFound } from '@api-client/found'
import type { FoundCase } from '@contracts/found'
import { evidenceTier } from '@domain/found/evidence'
import { holdOfferDue } from '@domain/found/machine'
import { formatRelative } from '@domain/shared/time'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { SAFETY_COPY, tierLabel } from './copy'

type Props = {
  foundCase: FoundCase
  now: Date
  /** After «Sí, es el dueño»: the next step is closing the case. */
  onConfirmed: () => void
  onKeep: () => void
  onTransfer: () => void
}

/**
 * What only the custodian sees (docs/product/05): each «Es mío» with its evidence labelled by how
 * hard it is to fake, the detail they withheld replayed to them, and the day-15 offer.
 */
export function CustodianPanel({ foundCase, now, onConfirmed, onKeep, onTransfer }: Props) {
  const answer = useAnswerOwnershipClaim(foundCase.code)
  const resolve = useResolveFound(foundCase.code)
  if (foundCase.viewer !== 'custodian' || foundCase.status !== 'active') return null

  const open = foundCase.ownershipClaims.filter((claim) => claim.status === 'open')
  const offer = holdOfferDue(
    {
      status: foundCase.status,
      offerAt: foundCase.holdOfferAt,
      hasConfirmedClaim: foundCase.ownershipClaims.some((claim) => claim.status === 'confirmed'),
    },
    now,
  )

  return (
    <>
      {offer ? (
        <section
          aria-label="Quince días sin dueño"
          className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4"
        >
          {/* An offer, not a warning: a finder has nothing to lose, the animal has a future to gain. */}
          <p className="m-0 font-bold">Nadie ha reclamado a este peludo en 15 días.</p>
          <p className="m-0 text-muted">Tú decides qué sigue para él.</p>
          <Button variant="outline" onClick={onTransfer}>
            Lo entregué a una fundación
          </Button>
          <Button variant="outline" onClick={onKeep}>
            Me lo quedo
          </Button>
          <Button
            variant="secondary"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ outcome: 'keep_searching' })}
          >
            Sigo buscando al dueño
          </Button>
        </section>
      ) : null}

      {open.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Posibles dueños">
          <h2 className="m-0 text-2xl font-extrabold">Dicen que es suyo</h2>
          {foundCase.withheldDetail ? (
            <Notice title={`Guardaste: «${foundCase.withheldDetail}».`}>
              Pregúntale por eso antes de entregar.
            </Notice>
          ) : null}
          <Notice tone="warning">{SAFETY_COPY}</Notice>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {open.map((claim) => (
              <li
                key={claim.id}
                className="flex flex-col gap-3 rounded-2xl border-2 border-brand p-4"
              >
                <p className="m-0">
                  <strong>{claim.claimantName}</strong>{' '}
                  <span className="text-muted">· {formatRelative(claim.createdAt, now)}</span>
                </p>
                <p className="m-0 font-semibold">
                  {
                    tierLabel[
                      evidenceTier({
                        fromLostCaseCode: claim.fromLostCaseCode,
                        notes: claim.evidenceNotes,
                        chipNumber: claim.chipNumber,
                        photoCount: claim.photoCount,
                      })
                    ]
                  }
                </p>
                {claim.evidenceNotes ? (
                  <p className="m-0 text-muted">«{claim.evidenceNotes}»</p>
                ) : null}
                {claim.chipNumber ? (
                  <p className="m-0 text-muted">Microchip: {claim.chipNumber}</p>
                ) : null}
                {claim.whatsappUrl ? (
                  <a
                    href={claim.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass('whatsapp')}
                  >
                    <WhatsAppIcon />
                    Abrir WhatsApp
                  </a>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    disabled={answer.isPending}
                    onClick={() =>
                      answer.mutate(
                        { claimId: claim.id, status: 'confirmed' },
                        { onSuccess: onConfirmed },
                      )
                    }
                  >
                    Sí, es el dueño
                  </Button>
                  <Button
                    variant="outline"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ claimId: claim.id, status: 'dismissed' })}
                  >
                    No es
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {answer.isError ? (
            <Notice tone="warning" title="No pudimos guardar tu respuesta.">
              Inténtalo de nuevo.
            </Notice>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
