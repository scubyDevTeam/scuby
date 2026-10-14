import { type FeedFilters, useFeed } from '@api-client/cases'
import type { Species, Vertical } from '@contracts/case'
import { useIsDesktop } from '@platform/viewport'
import { Button } from '@ui/Button'
import { Chips, type Option, Segmented } from '@ui/Choice'
import { FeedMap } from '@ui/Map/FeedMap'
import { Message, Skeleton } from '@ui/States'
import { MapPinOff, SearchX, WifiOff } from 'lucide-react'
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

type Props = {
  brandName: string
  mapStyleUrl: string | undefined
  caseLink: (code: string, children: ReactNode) => ReactNode
  onOpenCase: (code: string) => void
}

export function FeedPage({ brandName, mapStyleUrl, caseLink, onOpenCase }: Props) {
  const [vertical, setVertical] = useState<Vertical | All>('all')
  const [species, setSpecies] = useState<Species | All>('all')
  const [view, setView] = useState<'list' | 'map'>('list')
  // A phone shows the list or the map; a desktop has room for both, side by side.
  const isDesktop = useIsDesktop()
  const filters: FeedFilters = {
    vertical: vertical === 'all' ? undefined : vertical,
    species: species === 'all' ? undefined : species,
  }
  const feed = useFeed(filters)
  const now = new Date()
  const items = feed.data?.items ?? []

  return (
    <div className="mx-auto max-w-lg lg:max-w-6xl">
      <header className="flex items-center justify-between gap-3 rounded-b-3xl bg-brand px-5 py-4 text-white lg:hidden">
        <strong className="text-xl font-extrabold">{brandName}</strong>
        <div className="w-44">
          <Segmented label="Vista" options={views} value={view} onChange={setView} />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-5 py-5 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <h1 className="order-3 m-0 text-2xl font-extrabold lg:order-1 lg:text-4xl">
            {feed.data?.scope === 'national' ? 'En todo el país' : 'Cerca de ti, ahora'}
          </h1>
          <div className="order-1 lg:order-2">
            <Chips
              label="Tipo de aviso"
              options={verticals}
              value={vertical}
              onChange={setVertical}
            />
          </div>
          <div className="order-2 lg:order-3 lg:w-96">
            <Segmented
              label="Especie"
              options={speciesOptions}
              value={species}
              onChange={setSpecies}
            />
          </div>
        </div>

        {feed.data?.scope === 'national' ? (
          <p className="m-0 text-muted">
            Tu zona está vacía, así que te mostramos avisos de todo el país.
          </p>
        ) : null}

        {feed.isPending ? (
          <div className="flex flex-col gap-4" role="status" aria-label="Cargando avisos">
            <Skeleton className="h-40" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
        ) : items.length === 0 ? (
          <Message
            icon={<SearchX aria-hidden="true" className="size-10" />}
            title="No hay avisos con ese filtro"
          >
            Prueba con otro tipo de aviso u otra especie.
          </Message>
        ) : (
          <div className="lg:grid lg:grid-cols-[1fr_24rem] lg:items-start lg:gap-8">
            {isDesktop || view === 'list' ? (
              <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-3">
                {items.map((item, index) => (
                  <li key={item.code} className={index === 0 ? 'col-span-2 lg:col-span-3' : ''}>
                    <FeedCard
                      item={item}
                      now={now}
                      wide={index === 0}
                      link={(children) => caseLink(item.code, children)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            {isDesktop || view === 'map' ? (
              <section aria-label="Mapa de avisos" className="h-[70vh] lg:sticky lg:top-24">
                <FeedMap
                  styleUrl={mapStyleUrl}
                  markers={items.map((item) => ({
                    id: item.code,
                    point: item.point,
                    tone: item.vertical,
                  }))}
                  onSelect={onOpenCase}
                  unavailable={
                    <Message
                      icon={<MapPinOff aria-hidden="true" className="size-10" />}
                      title="No pudimos mostrar el mapa"
                    >
                      Puedes ver los mismos avisos en la lista.
                    </Message>
                  }
                />
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
