import { useSignOut } from '@api-client/session'
import type { User } from '@contracts/session'
import { initials } from '@domain/shared/signin'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'

/** docs/eng/auth.md · Profile. The email is the login identity and is not editable in v1. */
export function Profile({ user }: { user: User }) {
  const { t } = useI18n()
  const signOut = useSignOut()
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-8">
      <header className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-extrabold text-white">
          {initials(user.displayName)}
        </span>
        <h1 className="m-0 text-3xl font-extrabold">{user.displayName}</h1>
      </header>
      <section className="rounded-2xl bg-brand-mist p-4">
        <p className="m-0 text-sm text-muted">{t('auth.profile.email_label')}</p>
        <p className="m-0 font-bold">{user.email}</p>
      </section>
      <Button
        variant="link"
        className="self-start text-muted"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {t('auth.profile.sign_out')}
      </Button>
    </div>
  )
}
