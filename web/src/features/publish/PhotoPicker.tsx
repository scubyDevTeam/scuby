import { type UploadPurpose, useUploadPhoto } from '@api-client/owner'
import { fitWithin, isHeic, PHOTO_JPEG_QUALITY } from '@domain/shared/image'
import { useI18n } from '@i18n/react'
import { prepareImage, sha256Hex } from '@platform/image'
import { Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

const MAX_PHOTOS = 4

/**
 * Photos are re-encoded on the device, then uploaded one by one (docs/eng/media-pipeline.md §1).
 * The thumbnail of a photo picked here is the local one: the stored photo is processed after the
 * upload and may take seconds to exist, and the form never loses a photo the user already picked.
 */
export function PhotoPicker({
  purpose,
  urls,
  onChange,
}: {
  purpose: UploadPurpose
  urls: readonly string[]
  onChange: (urls: string[]) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const upload = useUploadPhoto(purpose)
  const [failed, setFailed] = useState<'heic' | 'other' | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const made = useRef(new Set<string>())

  // Object URLs hold the photo in memory until revoked.
  useEffect(() => {
    const all = made.current
    return () => {
      for (const preview of all) URL.revokeObjectURL(preview)
    }
  }, [])

  async function add(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setFailed(null)
    try {
      const prepared = await prepareImage(file, fitWithin, PHOTO_JPEG_QUALITY)
      const url = await upload.mutateAsync({ photo: prepared, sha256: await sha256Hex(prepared) })
      const preview = URL.createObjectURL(prepared)
      made.current.add(preview)
      setPreviews((current) => ({ ...current, [url]: preview }))
      onChange([...urls, url])
    } catch {
      setFailed(isHeic(file) ? 'heic' : 'other')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0">
        {urls.map((url, index) => (
          <li key={url} className="relative">
            <img
              src={previews[url] ?? url}
              alt={t('publish.photos.photo_n', { n: index + 1 })}
              className={`aspect-square w-full rounded-xl object-cover ${index === 0 ? 'ring-4 ring-lost' : ''}`}
            />
            <button
              type="button"
              aria-label={t('publish.photos.remove_n', { n: index + 1 })}
              onClick={() => onChange(urls.filter((u) => u !== url))}
              className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full bg-ink text-white"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
        {urls.length < MAX_PHOTOS ? (
          <li>
            <label
              htmlFor={id}
              className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-field p-1 text-center text-xs leading-tight text-muted"
            >
              <Plus aria-hidden="true" />
              {t(upload.isPending ? 'publish.photos.uploading' : 'publish.photos.add')}
            </label>
            <input
              id={id}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={upload.isPending}
              onChange={(event) => {
                add(event.target.files)
                event.target.value = ''
              }}
            />
          </li>
        ) : null}
      </ul>
      {failed ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t(failed === 'heic' ? 'publish.photos.failed_heic' : 'publish.photos.failed')}
        </p>
      ) : (
        <p className="m-0 text-sm text-muted">{t('publish.photos.first_on_poster')}</p>
      )}
    </div>
  )
}
