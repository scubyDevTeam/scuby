// «Comparte a Luna»: the poster in three formats and the three share buttons (docs/product/10 §3–4).
// Behind a lazy boundary — the poster, its canvas code and the QR encoder never load with the case.
import {
  CENTERED,
  type Crop,
  clampCrop,
  dragCrop,
  MAX_ZOOM,
  POSTER_FORMATS,
  type PosterFormat,
  pxToMm,
  SHARE_SHEET_FORMAT,
} from '@domain/shared/poster'
import { useI18n } from '@i18n/react'
import { downloadFile, shareImage } from '@platform/share'
import { Button, buttonClass } from '@ui/Button'
import { Segmented } from '@ui/Choice'
import { Notice } from '@ui/Notice'
import { Skeleton } from '@ui/States'
import { Download, MessageCircle, Share2 } from 'lucide-react'
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { posterLayout } from './layout'
import {
  isResponsible,
  ownerHint,
  type PosterCase,
  posterContent,
  type ShortLink,
  shareMessage,
  whatsappShareUrl,
} from './model'
import { type PreparedPoster, type PreparePoster, preparePoster } from './render'

type Props = {
  posterCase: PosterCase
  link: ShortLink
  brand: { name: string; markUrl: string }
  /** The canvas seam: tests hand in a fake, the app draws for real. */
  prepare?: PreparePoster
}

const FORMATS: readonly PosterFormat[] = ['square', 'story', 'print']
/** The preview is drawn small: a low-end phone must not repaint a 1080 px canvas per move. */
const PREVIEW_WIDTH = 640
const REDRAW_MS = 60

type Status = 'saved_copied' | 'saved' | 'failed' | null

export function PosterSheet({ posterCase, link, brand, prepare = preparePoster }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const responsible = isResponsible(posterCase)
  const [poster, setPoster] = useState<PreparedPoster | 'loading' | 'error'>('loading')
  const [format, setFormat] = useState<PosterFormat>(SHARE_SHEET_FORMAT)
  const [crop, setCrop] = useState<Crop>(CENTERED)
  const [notice, setNotice] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const message = shareMessage(i18n, posterCase, link)

  // Prepared once per case and language: the content is fixed while the sheet is open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` and the translator are read once on open.
  const content = useMemo(() => posterContent(i18n, posterCase, link, new Date()), [posterCase])

  useEffect(() => {
    let live = true
    prepare({ content, markUrl: brand.markUrl, brandName: brand.name }).then(
      (ready) => live && setPoster(ready),
      () => live && setPoster('error'),
    )
    return () => {
      live = false
    }
  }, [prepare, content, brand.markUrl, brand.name])

  // Redraw at most every REDRAW_MS while the photo is dragged, always ending on the last crop.
  useEffect(() => {
    if (typeof poster !== 'object' || !canvas.current) return
    const target = canvas.current
    const timer = setTimeout(() => {
      try {
        poster.draw(target, format, crop, PREVIEW_WIDTH / POSTER_FORMATS[format].width)
      } catch {
        setPoster('error')
      }
    }, REDRAW_MS)
    return () => clearTimeout(timer)
  }, [poster, format, crop])

  if (poster === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="warning">{t('sharing.error')}</Notice>
        <WhatsappButton message={message} />
      </div>
    )
  }

  const ready = typeof poster === 'object' ? poster : null
  const framing = responsible && ready?.photoSize != null

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!framing) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY }
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const from = drag.current
    if (!from || !ready?.photoSize) return
    drag.current = { x: event.clientX, y: event.clientY }
    const layout = posterLayout(format)
    // Screen pixels to poster pixels: the canvas is shown smaller than it is.
    const ratio = layout.width / (event.currentTarget.getBoundingClientRect().width || 1)
    const photoSize = ready.photoSize
    setCrop((current) =>
      dragCrop(
        current,
        photoSize,
        layout.photo,
        (event.clientX - from.x) * ratio,
        (event.clientY - from.y) * ratio,
      ),
    )
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch {
      setNotice('failed')
    } finally {
      setBusy(false)
    }
  }

  const share = () =>
    run(async () => {
      if (!ready) return
      const result = await shareImage({
        file: await ready.toFile(SHARE_SHEET_FORMAT, crop),
        text: message,
      })
      if (result.kind === 'saved') setNotice(result.copied ? 'saved_copied' : 'saved')
    })

  const download = () =>
    run(async () => {
      if (ready) downloadFile(await ready.toFile(format, crop))
    })

  const { width, height } = POSTER_FORMATS[format]
  const qrCm = (pxToMm(posterLayout('print').qr.width) / 10).toLocaleString(i18n.locale, {
    maximumFractionDigits: 1,
  })

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label={t('sharing.format_label')}
        options={FORMATS.map((value) => ({ value, label: t(`sharing.formats.${value}`) }))}
        value={format}
        onChange={setFormat}
      />

      <div className="flex justify-center">
        {ready ? null : (
          <div className="w-full max-w-[18rem]" style={{ aspectRatio: `${width} / ${height}` }}>
            <Skeleton className="h-full" />
          </div>
        )}
        <canvas
          ref={canvas}
          role="img"
          aria-label={t('sharing.preview', { format: t(`sharing.formats.${format}`) })}
          data-format={format}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          className={`max-h-[55dvh] max-w-full rounded-2xl shadow-lg ${ready ? '' : 'hidden'} ${
            framing ? 'cursor-grab touch-none' : ''
          }`}
          style={{ aspectRatio: `${width} / ${height}` }}
        />
      </div>

      {framing ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <label className="flex min-w-0 items-center gap-3 font-semibold">
            {t('sharing.framer.label')}
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onChange={(event) =>
                setCrop((current) => clampCrop({ ...current, zoom: Number(event.target.value) }))
              }
              className="w-full min-w-0 flex-1 accent-brand"
            />
          </label>
          <Button variant="link" className="whitespace-nowrap" onClick={() => setCrop(CENTERED)}>
            {t('sharing.framer.recenter')}
          </Button>
        </div>
      ) : null}

      {format === 'print' ? <Notice>{t('sharing.print_hint', { size: qrCm })}</Notice> : null}

      <WhatsappButton message={message} />
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={share} disabled={!ready || busy}>
          <Share2 aria-hidden="true" />
          {t('sharing.actions.share')}
        </Button>
        <Button variant="outline" onClick={download} disabled={!ready || busy}>
          <Download aria-hidden="true" />
          {format === 'print' ? t('sharing.actions.download_pdf') : t('sharing.actions.download')}
        </Button>
      </div>

      {notice === 'saved_copied' || notice === 'saved' ? (
        <Notice tone="success">{t(`sharing.${notice}`)}</Notice>
      ) : null}
      {notice === 'failed' ? <Notice tone="warning">{t('sharing.error')}</Notice> : null}

      {responsible ? <p className="m-0 text-muted">{ownerHint(i18n, posterCase)}</p> : null}
    </div>
  )
}

function WhatsappButton({ message }: { message: string }) {
  const { t } = useI18n()
  return (
    <a
      href={whatsappShareUrl(message)}
      target="_blank"
      rel="noreferrer"
      className={buttonClass('whatsapp')}
    >
      <MessageCircle aria-hidden="true" />
      {t('sharing.actions.whatsapp')}
    </a>
  )
}
