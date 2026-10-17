import { ApiError } from '@api-client/http'
import { useDeleteAccount, useProfile, useSignOut, useUpdateProfile } from '@api-client/session'
import type { Profile as ProfileData, ProfileUpdate } from '@contracts/session'
import { BIO_MAX_LENGTH, type ProfileError, profileErrors } from '@domain/shared/profile'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Button } from '@ui/Button'
import { Switch, TextArea, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { Message, Skeleton } from '@ui/States'
import { WifiOff } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { NearbyAlerts } from './NearbyAlerts'
import { PhoneChange } from './PhoneChange'
import { ProfilePhoto } from './ProfilePhoto'

/** The contract's limit on the name and the city (`profileUpdateRequest`). */
const SHORT_TEXT_MAX = 80

const JOURNEYS = ['lost', 'found', 'adoption', 'help'] as const

const journeyLabel: Record<(typeof JOURNEYS)[number], TextKey> = {
  lost: 'auth.profile.notifications.lost',
  found: 'auth.profile.notifications.found',
  adoption: 'auth.profile.notifications.adoption',
  help: 'auth.profile.notifications.help',
}

const errorCopy: Record<ProfileError, TextKey> = {
  name_required: 'auth.profile.errors.name_required',
  bio_has_link: 'auth.profile.errors.bio_has_link',
  bio_too_long: 'auth.profile.errors.bio_too_long',
}

/**
 * docs/eng/auth.md · Profile: the name, city, bio and notification toggles are edited here. The
 * email is the login identity and is not editable in v1; the phone is shown, and changed at the
 * next publish (the phone step re-verifies it).
 */
export function Profile({
  mapStyleUrl,
  demoCode,
}: {
  mapStyleUrl?: string
  /** Set when the backend is emulated: the SMS code it accepts. */
  demoCode?: string
}) {
  const { t } = useI18n()
  const profile = useProfile()
  const signOut = useSignOut()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-8">
      {profile.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label={t('auth.profile.loading')}>
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : profile.isError ? (
        <Message
          icon={<WifiOff aria-hidden="true" className="size-10" />}
          title={t('auth.profile.load_failed')}
          action={<Button onClick={() => profile.refetch()}>{t('common.retry')}</Button>}
        >
          {t('common.check_connection')}
        </Message>
      ) : (
        <>
          <header className="flex items-center gap-4">
            <ProfilePhoto name={profile.data.displayName} photoUrl={profile.data.photoUrl} />
            <h1 className="m-0 text-3xl font-extrabold">{profile.data.displayName}</h1>
          </header>
          <Account profile={profile.data} demoCode={demoCode} />
          <NearbyAlerts mapStyleUrl={mapStyleUrl} />
          <ProfileForm profile={profile.data} />
        </>
      )}
      <Button
        variant="link"
        className="self-start text-muted"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {t('auth.profile.sign_out')}
      </Button>
      {profile.data ? <DeleteAccount /> : null}
    </div>
  )
}

/** What identifies the account and is not edited here: the email, the verified phone. */
function Account({ profile, demoCode }: { profile: ProfileData; demoCode?: string }) {
  const { t } = useI18n()
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-brand-mist p-4">
      <div>
        <p className="m-0 text-sm text-muted">{t('auth.profile.email_label')}</p>
        <p className="m-0 font-bold">{profile.email}</p>
        <p className="m-0 text-sm text-muted">{t('auth.profile.email_hint')}</p>
      </div>
      {changing ? (
        <PhoneChange
          demoCode={demoCode}
          onCancel={() => setChanging(false)}
          onDone={() => {
            setChanging(false)
            setChanged(true)
          }}
        />
      ) : (
        <div className="flex items-start justify-between gap-3">
          {profile.phone ? (
            <div>
              <p className="m-0 text-sm text-muted">{t('auth.profile.phone_label')}</p>
              <p className="m-0 font-bold">{profile.phone}</p>
              <p className="m-0 text-sm text-muted">{t('auth.profile.phone_hint')}</p>
            </div>
          ) : (
            <p className="m-0 text-sm text-muted">{t('auth.profile.no_phone')}</p>
          )}
          <button
            type="button"
            className="min-h-11 shrink-0 cursor-pointer font-bold text-brand-deep"
            onClick={() => {
              setChanged(false)
              setChanging(true)
            }}
          >
            {t(
              profile.phone ? 'auth.profile.phone_change.change' : 'auth.profile.phone_change.add',
            )}
          </button>
        </div>
      )}
      {changed ? <Notice tone="success">{t('auth.profile.phone_change.done')}</Notice> : null}
    </section>
  )
}

type Draft = {
  displayName: string
  city: string
  bio: string
  notificationPrefs: ProfileData['notificationPrefs']
}

const draftOf = (profile: ProfileData): Draft => ({
  displayName: profile.displayName,
  city: profile.city ?? '',
  bio: profile.bio ?? '',
  notificationPrefs: profile.notificationPrefs,
})

/** Only what changed is sent; an emptied optional field is sent as null. */
function changesOf(profile: ProfileData, draft: Draft): ProfileUpdate | null {
  const changes: ProfileUpdate = {}
  const displayName = draft.displayName.trim()
  const city = draft.city.trim() || null
  const bio = draft.bio.trim() || null
  if (displayName !== profile.displayName) changes.displayName = displayName
  if (city !== profile.city) changes.city = city
  if (bio !== profile.bio) changes.bio = bio
  if (JOURNEYS.some((j) => draft.notificationPrefs[j] !== profile.notificationPrefs[j])) {
    changes.notificationPrefs = draft.notificationPrefs
  }
  return Object.keys(changes).length > 0 ? changes : null
}

function ProfileForm({ profile }: { profile: ProfileData }) {
  const { t } = useI18n()
  const update = useUpdateProfile()
  const [draft, setDraft] = useState(() => draftOf(profile))
  const [tried, setTried] = useState(false)

  const errors = tried ? profileErrors(draft) : []
  const has = (error: ProfileError) => errors.includes(error)
  const failure = update.error instanceof ApiError ? update.error : null
  // `validation_failed` names the wire fields it refused; the copy is ours, never the server's.
  const refused = failure?.code === 'validation_failed' ? failure.fields : {}
  const refusedField = 'display_name' in refused || 'city' in refused || 'bio' in refused
  const changes = changesOf(profile, draft)

  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    if (!update.isIdle) update.reset()
  }

  const nameError = has('name_required')
    ? t(errorCopy.name_required)
    : 'display_name' in refused
      ? t('auth.profile.errors.name_rejected')
      : null
  const bioError = has('bio_has_link')
    ? t(errorCopy.bio_has_link)
    : has('bio_too_long')
      ? t(errorCopy.bio_too_long)
      : 'bio' in refused
        ? t('auth.profile.errors.bio_rejected')
        : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (profileErrors(draft).length > 0 || !changes) return
    update.mutate(changes)
  }

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
      <TextField
        label={t('auth.profile.name_label')}
        hint={t('auth.profile.name_hint')}
        error={nameError}
        autoComplete="name"
        maxLength={SHORT_TEXT_MAX}
        value={draft.displayName}
        onChange={(event) => edit({ displayName: event.target.value })}
      />
      <TextField
        label={t('auth.profile.city_label')}
        optional
        placeholder={t('auth.profile.city_placeholder')}
        error={'city' in refused ? t('auth.profile.errors.city_rejected') : null}
        autoComplete="address-level2"
        maxLength={SHORT_TEXT_MAX}
        value={draft.city}
        onChange={(event) => edit({ city: event.target.value })}
      />
      <TextArea
        label={t('auth.profile.bio_label')}
        optional
        hint={t('auth.profile.bio_hint', { length: draft.bio.length, max: BIO_MAX_LENGTH })}
        error={bioError}
        rows={4}
        value={draft.bio}
        onChange={(event) => edit({ bio: event.target.value })}
      />

      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="mb-1 p-0 text-lg font-extrabold">
          {t('auth.profile.notifications_title')}
        </legend>
        {JOURNEYS.map((journey) => (
          <Switch
            key={journey}
            label={t(journeyLabel[journey])}
            checked={draft.notificationPrefs[journey]}
            onChange={(on) =>
              edit({ notificationPrefs: { ...draft.notificationPrefs, [journey]: on } })
            }
          />
        ))}
        <p className="m-0 text-sm text-muted">{t('auth.profile.notifications_hint')}</p>
      </fieldset>

      {update.isSuccess ? <Notice tone="success">{t('auth.profile.saved')}</Notice> : null}
      {update.isError && !refusedField ? (
        <Notice tone="warning" title={t('common.save_failed')}>
          {failure?.kind === 'network' ? t('common.check_connection') : t('common.try_again')}
        </Notice>
      ) : null}

      <Button type="submit" disabled={update.isPending || !changes}>
        {update.isPending ? t('auth.profile.saving') : t('auth.profile.save')}
      </Button>
    </form>
  )
}

/** «Eliminar mi cuenta» (O15): the stores require it in the app; it asks once, plainly. */
function DeleteAccount() {
  const { t } = useI18n()
  const remove = useDeleteAccount()
  const [asking, setAsking] = useState(false)
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      {asking ? (
        <>
          <h2 className="m-0 text-lg font-bold">{t('auth.profile.delete.title')}</h2>
          <p className="m-0 text-muted">{t('auth.profile.delete.body')}</p>
          {remove.isError ? (
            <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
              {t('auth.profile.delete.failed')}
            </p>
          ) : null}
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t(remove.isPending ? 'auth.profile.delete.deleting' : 'auth.profile.delete.confirm')}
          </Button>
          <Button variant="outline" onClick={() => setAsking(false)}>
            {t('auth.profile.delete.cancel')}
          </Button>
        </>
      ) : (
        <Button
          variant="link"
          className="self-start text-lost-deep"
          onClick={() => setAsking(true)}
        >
          {t('auth.profile.delete.start')}
        </Button>
      )}
    </section>
  )
}
