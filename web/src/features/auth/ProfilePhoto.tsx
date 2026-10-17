import { useUploadPhoto } from '@api-client/owner'
import { useUpdateProfile } from '@api-client/session'
import { fitWithin, PHOTO_JPEG_QUALITY } from '@domain/shared/image'
import { initials } from '@domain/shared/signin'
import { useI18n } from '@i18n/react'
import { prepareImage } from '@platform/image'
import { useId, useState } from 'react'

/** The profile photo (auth.md · Profile `photo?`): re-encoded on the device, then uploaded. */
export function ProfilePhoto({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const { t } = useI18n()
  const id = useId()
  const upload = useUploadPhoto()
  const update = useUpdateProfile()
  const [failed, setFailed] = useState(false)
  const busy = upload.isPending || update.isPending

  async function pick(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setFailed(false)
    try {
      const prepared = await prepareImage(file, fitWithin, PHOTO_JPEG_QUALITY)
      const url = await upload.mutateAsync(prepared)
      await update.mutateAsync({ photoUrl: url })
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={t('auth.profile.photo.alt')}
          className="size-16 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-extrabold text-white">
          {initials(name)}
        </span>
      )}
      <label
        htmlFor={id}
        className={`cursor-pointer text-sm font-bold text-brand-deep ${busy ? 'opacity-50' : ''}`}
      >
        {t(photoUrl ? 'auth.profile.photo.change' : 'auth.profile.photo.add')}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={busy}
        onChange={(event) => void pick(event.target.files)}
      />
      {photoUrl ? (
        <button
          type="button"
          className="cursor-pointer text-sm text-muted"
          disabled={busy}
          onClick={() => update.mutate({ photoUrl: null })}
        >
          {t('auth.profile.photo.remove')}
        </button>
      ) : null}
      {failed ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('auth.profile.photo.failed')}
        </p>
      ) : null}
    </div>
  )
}
