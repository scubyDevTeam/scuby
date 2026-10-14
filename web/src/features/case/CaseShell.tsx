import { useI18n } from '@i18n/react'
import { roundButtonClass } from '@ui/Button'
import { Share2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'

type Props = {
  /** The status strip: «SE BUSCA», «SE ENCONTRÓ», «YA ESTÁ EN CASA»… in its colour. */
  band: { label: string; className: string }
  /** Host and code as printed on the band — the address people type from a poster. */
  shortUrl: string
  photoUrls: readonly string[]
  photoAlt: string
  backLink: ReactNode
  onShare: (() => void) | undefined
  /** Details that sit under the photo on a desktop and after the story on a phone. */
  aside: ReactNode
  /** The story: title, actions, notices, map. */
  children: ReactNode
}

/**
 * The frame every case page shares (docs/product/10 §1: status first). Phone: one column — photo,
 * band, story, details. Desktop: band on top, photo and details left, story right.
 */
export function CaseShell({
  band,
  shortUrl,
  photoUrls,
  photoAlt,
  backLink,
  onShare,
  aside,
  children,
}: Props) {
  const { t } = useI18n()
  return (
    <article className="mx-auto flex max-w-lg flex-col pb-10 lg:max-w-none">
      <div
        className={`order-2 flex items-center justify-between gap-3 px-5 py-3 text-white lg:order-1 lg:px-[max(2rem,calc((100vw-72rem)/2+2rem))] ${band.className}`}
      >
        <strong className="text-lg tracking-widest uppercase">{band.label}</strong>
        <span className="font-mono text-sm font-bold">{shortUrl}</span>
      </div>

      <div className="contents lg:order-2 lg:mx-auto lg:grid lg:w-full lg:max-w-6xl lg:grid-cols-[5fr_6fr] lg:items-start lg:gap-x-12 lg:px-8 lg:pt-10">
        <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:flex-col lg:gap-8">
          <header className="relative order-1">
            <Gallery urls={photoUrls} alt={photoAlt} />
            <div className="absolute inset-x-4 top-4 flex justify-between lg:hidden">
              {backLink}
              {onShare ? (
                <button
                  type="button"
                  aria-label={t('common.share')}
                  onClick={onShare}
                  className={roundButtonClass}
                >
                  <Share2 aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </header>
          <div className="order-4 flex flex-col gap-6 px-5 pt-6 lg:px-0 lg:pt-0">{aside}</div>
        </div>
        <div className="order-3 flex flex-col gap-6 px-5 pt-5 lg:col-start-2 lg:row-start-1 lg:px-0 lg:pt-0">
          {children}
        </div>
      </div>
    </article>
  )
}

function Gallery({ urls, alt }: { urls: readonly string[]; alt: string }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState(0)
  const current = urls[selected] ?? urls[0]
  if (!current) return <div className="aspect-square w-full bg-soft lg:rounded-3xl" />
  const photo = (
    <img src={current} alt={alt} className="aspect-square w-full object-cover lg:rounded-3xl" />
  )
  if (urls.length === 1) return photo

  return (
    <div className="flex flex-col gap-3">
      {/* On a phone the photo itself is the control; a desktop has room for thumbnails. */}
      <button
        type="button"
        aria-label={t('case.next_photo')}
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
              aria-label={t('case.photo_n', { n: index + 1 })}
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
