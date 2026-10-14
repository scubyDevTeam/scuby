import { useUploadPhoto } from '@api-client/owner'
import { fitWithin, PHOTO_JPEG_QUALITY } from '@domain/shared/image'
import { prepareImage } from '@platform/image'
import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'

const MAX_PHOTOS = 4

/** Photos are re-encoded on the device, then uploaded one by one (docs/eng/media-pipeline.md §1). */
export function PhotoPicker({
  urls,
  onChange,
}: {
  urls: readonly string[]
  onChange: (urls: string[]) => void
}) {
  const id = useId()
  const upload = useUploadPhoto()
  const [failed, setFailed] = useState(false)

  async function add(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setFailed(false)
    try {
      const prepared = await prepareImage(file, fitWithin, PHOTO_JPEG_QUALITY)
      const url = await upload.mutateAsync(prepared)
      onChange([...urls, url])
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0">
        {urls.map((url, index) => (
          <li key={url} className="relative">
            <img
              src={url}
              alt={`Foto ${index + 1}`}
              className={`aspect-square w-full rounded-xl object-cover ${index === 0 ? 'ring-4 ring-lost' : ''}`}
            />
            <button
              type="button"
              aria-label={`Quitar foto ${index + 1}`}
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
              className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-field text-sm text-muted"
            >
              <Plus aria-hidden="true" />
              {upload.isPending ? 'Subiendo…' : 'Agregar foto'}
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
          No pudimos subir esa foto. Inténtalo de nuevo.
        </p>
      ) : (
        <p className="m-0 text-sm text-muted">La primera va en el afiche.</p>
      )}
    </div>
  )
}
