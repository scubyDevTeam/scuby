import { type FeedFilters, useFeed } from '@api-client/cases'
import type { Species, Vertical } from '@contracts/case'
import { Button } from '@ui/Button'
import { Chips, type Option, Segmented } from '@ui/Choice'
import { Message, Skeleton } from '@ui/States'
import { MapPin, SearchX, WifiOff } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { FeedCard } from './FeedCard'

type All = 'all'

const verticals: Option<Vertical | All>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'lost', label: 'Perdidos', className: 'text-lost-deep' },
  { value: 'found', label: 'Encontrados', className: 'text-found' },
  { value: 'adoption', label: 'Adopción', className: 'text-brand-deep' },
  { value: 'help', label: 'Ayuda', className: 'text-help' },
]

const speciesOptions: Option<Species | All>[] = [
  { value: 'all', label: 'Todas' },
  { value: 'dog', label: 'Perros' },
  { value: 'cat', label: 'Gatos' },
  { value: 'other', label: 'Otros' },
]

const views: Option<'list' | 'map'>[] = [
  { value: 'list', label: 'Lista' },
  { value: 'map', label: 'Mapa' },
]

export function FeedPage({
  brandName,
  caseLink,
}: {
  brandName: string
  caseLink: (code: string, children: ReactNode) => ReactNode
}) {
  const [vertical, setVertical] = useState<Vertical | All>('all')
  const [species, setSpecies] = useState<Species | All>('all')
  const [view, setView] = useState<'list' | 'map'>('list')
  const filters: FeedFilters = {
    vertical: vertical === 'all' ? undefined : vertical,
    species: species === 'all' ? undefined : species,
  }
  const feed = useFeed(filters)
  const now = new Date()

  return (
    <div className="mx-auto max-w-lg">
      <header className="flex items-center justify-between gap-3 rounded-b-3xl bg-brand px-5 py-4 text-white">
        <strong className="text-xl font-extrabold">{brandName}</strong>
        <div className="w-44">
          <Segmented label="Vista" options={views} value={view} onChange={setView} />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-5 py-5">
        <Chips label="Tipo de aviso" options={verticals} value={vertical} onChange={setVertical} />
        <Segmented label="Especie" options={speciesOptions} value={species} onChange={setSpecies} />

        {view === 'map' ? (
          <Message
            icon={<MapPin aria-hidden="true" className="size-10" />}
            title="El mapa viene en camino"
          >
            Por ahora puedes ver los avisos en la lista.
          </Message>
        ) : feed.isPending ? (
          <div className="flex flex-col gap-4" role="status" aria-label="Cargando avisos">
            <Skeleton className="h-40" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-56" />
              <Skeleton className="h-56" />
            </div>
          </div>
        ) : feed.isError ? (
          <Message
            icon={<WifiOff aria-hidden="true" className="size-10" />}
            title="No pudimos cargar los avisos"
            action={<Button onClick={() => feed.refetch()}>Reintentar</Button>}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </Message>
        ) : feed.data.items.length === 0 ? (
          <Message
            icon={<SearchX aria-hidden="true" className="size-10" />}
            title="No hay avisos con ese filtro"
          >
            Prueba con otro tipo de aviso u otra especie.
          </Message>
        ) : (
          <section className="flex flex-col gap-4">
            <h2 className="m-0 text-2xl font-extrabold">
              {feed.data.scope === 'local' ? 'Cerca de ti, ahora' : 'En todo el país'}
            </h2>
            {feed.data.scope === 'national' ? (
              <p className="m-0 text-muted">
                Tu zona está vacía, así que te mostramos avisos de todo el país.
              </p>
            ) : null}
            <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0">
              {feed.data.items.map((item, index) => (
                <li key={item.code} className={index === 0 ? 'col-span-2' : ''}>
                  <FeedCard
                    item={item}
                    now={now}
                    wide={index === 0}
                    link={(children) => caseLink(item.code, children)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
