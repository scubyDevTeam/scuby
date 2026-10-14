import { useMyCases } from '@api-client/owner'
import type { MyCase } from '@contracts/owner'
import { formatRelative } from '@domain/shared/time'
import { Badge, type BadgeTone } from '@ui/Badge'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { FilePlus2, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

const statusBadge: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: 'lost', label: 'Aviso activo' },
  reunited: { tone: 'found', label: 'Ya está en casa' },
  expired: { tone: 'info', label: 'Archivado' },
  cancelled: { tone: 'info', label: 'Cerrado' },
}

type Props = {
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
  publishLink: (children: ReactNode, className: string) => ReactNode
}

/** Everything the signed-in person has published, newest first. */
export function MyCases({ caseLink, publishLink }: Props) {
  const cases = useMyCases()
  const now = new Date()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8 lg:max-w-3xl">
      <h1 className="m-0 text-3xl font-extrabold">Mis casos</h1>
      {cases.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Cargando tus casos">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : cases.isError ? (
        <Message
          icon={<WifiOff aria-hidden="true" className="size-10" />}
          title="No pudimos cargar tus casos"
          action={<Button onClick={() => cases.refetch()}>Reintentar</Button>}
        >
          Revisa tu conexión e inténtalo de nuevo.
        </Message>
      ) : cases.data.length === 0 ? (
        <Message
          icon={<FilePlus2 aria-hidden="true" className="size-10" />}
          title="Aún no has publicado nada"
          action={publishLink(
            'Publicar un aviso',
            'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
          )}
        >
          Cuando publiques un aviso lo verás aquí.
        </Message>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {cases.data.map((item) => (
            <li key={item.code}>
              {caseLink(
                item.code,
                <Row item={item} now={now} />,
                'block text-inherit no-underline',
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ item, now }: { item: MyCase; now: Date }) {
  const badge = statusBadge[item.status] ?? { tone: 'info' as const, label: item.status }
  return (
    <article className="flex items-center gap-4 rounded-2xl bg-surface p-3 shadow-md">
      {item.photoUrl ? (
        <img src={item.photoUrl} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="size-20 shrink-0 rounded-xl bg-soft" />
      )}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <div className="flex flex-wrap gap-1">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {item.status === 'active' && item.openClaimCount > 0 ? (
            <Badge tone="info">Posible hallazgo</Badge>
          ) : null}
        </div>
        <h2 className="m-0 text-xl font-extrabold">{item.title}</h2>
        <p className="m-0 text-muted">
          {item.placeName} · {formatRelative(item.publishedAt, now)}
        </p>
      </div>
    </article>
  )
}
