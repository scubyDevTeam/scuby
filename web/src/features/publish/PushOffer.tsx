import { useRegisterPush } from '@api-client/session'
import { pushOffer } from '@domain/shared/push'
import { useI18n } from '@i18n/react'
import {
  installHintShown,
  markInstallHintShown,
  pushPermission,
  pushSupport,
  subscribePush,
} from '@platform/push'
import { Button } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { BellRing, Share } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type State = 'idle' | 'asking' | 'done' | 'denied' | 'failed' | 'closed'

/**
 * The moment to ask for push (docs/eng/frontend.md · Push): the case is live and the first
 * check-in is yet to fire. Never on first load. On iOS in a Safari tab, the add-to-home-screen
 * instruction instead — once, dismissible.
 */
export function PushOffer() {
  const { t } = useI18n()
  const register = useRegisterPush()
  // Decided once per screen: the answer must not change under the person reading it.
  const [offer] = useState(() =>
    pushOffer({
      support: pushSupport(),
      permission: pushPermission(),
      installHintShown: installHintShown(),
    }),
  )
  const [state, setState] = useState<State>('idle')
  const started = useRef(false)

  async function enable() {
    setState('asking')
    const outcome = await subscribePush()
    if (outcome === 'denied') return setState('denied')
    if (outcome === 'dismissed') return setState('idle')
    if (outcome === 'unavailable') return setState('failed')
    register.mutate(
      { ...outcome, device: null },
      { onSuccess: () => setState('done'), onError: () => setState('failed') },
    )
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (offer === 'install_hint') markInstallHintShown()
    // Permission given earlier: keep this install registered without asking again.
    if (offer === 'register') void enable()
  })

  if (offer === 'none' || offer === 'register' || state === 'closed') return null

  if (offer === 'install_hint') {
    return (
      <section className="flex flex-col gap-2">
        <Notice tone="info" icon={<Share aria-hidden="true" className="size-5" />}>
          {t('push.install.body')}
        </Notice>
        <Button variant="link" className="self-end" onClick={() => setState('closed')}>
          {t('push.install.dismiss')}
        </Button>
      </section>
    )
  }

  if (state === 'done') return <Notice tone="success">{t('push.offer.done')}</Notice>
  if (state === 'denied') return <Notice tone="neutral">{t('push.offer.denied')}</Notice>

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-brand-ice p-4">
      <div className="flex gap-3">
        <BellRing aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-deep" />
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-bold">{t('push.offer.title')}</h2>
          <p className="m-0">{t('push.offer.body')}</p>
        </div>
      </div>
      {state === 'failed' ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('push.offer.failed')}
        </p>
      ) : null}
      <Button variant="primary" disabled={state === 'asking'} onClick={enable}>
        {t(state === 'asking' ? 'push.offer.enabling' : 'push.offer.enable')}
      </Button>
      <Button variant="link" className="self-center" onClick={() => setState('closed')}>
        {t('push.offer.later')}
      </Button>
    </section>
  )
}
