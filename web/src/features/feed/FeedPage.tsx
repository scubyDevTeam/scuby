import { type FeedFilters, useFeed } from '@api-client/cases'
import type { Species, Vertical } from '@contracts/case'
import { useI18n } from '@i18n/react'
import { useIsDesktop } from '@platform/viewport'
import { Button } from '@ui/Button'
import { Chips, type Option, Segmented } from '@ui/Choice'
import { FeedMap } from '@ui/Map/FeedMap'
import { Message, Skeleton } from '@ui/States'
import { MapPinOff, SearchX, WifiOff } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { FeedCard } from './FeedCard'

type All = 'all'

// Labels read `feed.verticals.<value>`, `feed.species.<value>` and `feed.views.<value>`.
const verticals: { value: Vertical | All; className?: string }[] = [
  { value: 'all' },
  { value: 'lost', className: 'text-lost-deep' },
  { value: 'found', className: 'text-found' },
  { value: 'adoption', className: 'text-brand-deep' },
  { value: 'help', className: 'text-help' },
]
const speciesValues: readonly (Species | All)[] = ['all', 'dog', 'cat', 'other']
const viewValues = ['list', 'map'] as const

type Props = {
  brandName: string
  brandMarkUrl: string
  mapStyleUrl: string | undefined
  caseLink: (code: string, children: ReactNode) => ReactNode
  onOpenCase: (code: string) => void
}

export function FeedPage({ brandName, brandMarkUrl, mapStyleUrl, caseLink, onOpenCase }: Props) {
  const { t } = useI18n()
  const verticalOptions: Option<Vertical | All>[] = verticals.map((entry) => ({
    ...entry,
    label: t(`feed.verticals.${entry.value}`),
  }))
  const speciesOptions: Option<Species | All>[] = speciesValues.map((value) => ({
    value,
    label: t(`feed.species.${value}`),
  }))
  const views: Option<'list' | 'map'>[] = viewValues.map((value) => ({
    value,
    label: t(`feed.views.${value}`),
  }))
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
        <strong className="flex items-center gap-2 text-xl font-extrabold">
          <img src={brandMarkUrl} alt="" className="h-8 w-auto" />
          {brandName}
        </strong>
        <div className="w-44">
          <Segmented
            label={t('feed.views.label')}
            options={views}
            value={view}
            onChange={setView}
          />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-5 py-5 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <h1 className="order-3 m-0 text-2xl font-extrabold lg:order-1 lg:text-4xl">
            {t(feed.data?.scope === 'national' ? 'feed.title_national' : 'feed.title_local')}
          </h1>
          <div className="order-1 lg:order-2">
            <Chips
              label={t('feed.verticals.label')}
              options={verticalOptions}
              value={vertical}
              onChange={setVertical}
            />
          </div>
          <div className="order-2 lg:order-3 lg:w-96">
            <Segmented
              label={t('pet.species_label')}
              options={speciesOptions}
              value={species}
              onChange={setSpecies}
            />
          </div>
        </div>

        {feed.data?.scope === 'national' ? (
          <p className="m-0 text-muted">{t('feed.national_hint')}</p>
        ) : null}

        {feed.isPending ? (
          <div className="flex flex-col gap-4" role="status" aria-label={t('feed.loading')}>
            <Skeleton className="h-40" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Skeleton className="h-56" />
              <Skeleton className="h-56" />
            </div>
          </div>
        ) : feed.isError ? (
          <Message
            icon={<WifiOff aria-hidden="true" className="size-10" />}
            title={t('feed.load_failed')}
            action={<Button onClick={() => feed.refetch()}>{t('common.retry')}</Button>}
          >
            {t('common.check_connection')}
          </Message>
        ) : items.length === 0 ? (
          <Message
            icon={<SearchX aria-hidden="true" className="size-10" />}
            title={t('feed.empty_title')}
          >
            {t('feed.empty_hint')}
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
              <section aria-label={t('feed.map_label')} className="h-[70vh] lg:sticky lg:top-24">
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
                      title={t('feed.map_failed')}
                    >
                      {t('feed.map_failed_hint')}
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
