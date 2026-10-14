import type { Candidate } from '@contracts/found'
import { Button } from '@ui/Button'

/**
 * «¿Es este?» (docs/product/05 · Matching): candidates are always confirmed by a person, and each
 * says why it was suggested. A wrong one costs a tap to dismiss.
 */
export function Candidates({
  candidates,
  onPick,
  onNone,
  noneLabel,
}: {
  candidates: readonly Candidate[]
  onPick: (candidate: Candidate) => void
  onNone: () => void
  noneLabel: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-muted">Alguien cerca está buscando una mascota parecida.</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {candidates.map((candidate) => (
          <li
            key={candidate.code}
            className="flex items-center gap-4 rounded-2xl bg-surface p-3 shadow-md"
          >
            {candidate.photoUrl ? (
              <img
                src={candidate.photoUrl}
                alt=""
                className="size-20 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="size-20 shrink-0 rounded-xl bg-soft" />
            )}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <h2 className="m-0 text-xl font-extrabold">{candidate.name}</h2>
              <p className="m-0 text-sm text-muted">{candidate.why.join(' · ')}</p>
              <Button className="w-auto" onClick={() => onPick(candidate)}>
                Sí, es {candidate.name}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="outline" onClick={onNone}>
        {noneLabel}
      </Button>
    </div>
  )
}
