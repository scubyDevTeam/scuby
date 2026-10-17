import { useI18n } from '@i18n/react'
import { env, RESET_DEMO_EVENT } from '../env'

/**
 * Only with the emulated backend: its data lives in this browser, so a demo that got into a strange
 * state can start over from the fixtures. A production build never shows it.
 */
export function ResetDemo() {
  const { t } = useI18n()
  if (!env.apiMock) return null
  return (
    <button
      type="button"
      className="min-h-11 cursor-pointer self-start text-sm font-semibold text-muted underline"
      // main.tsx owns the emulated backend (the layer rule): it hears this and resets it.
      onClick={() => window.dispatchEvent(new Event(RESET_DEMO_EVENT))}
    >
      {t('app.demo.reset')}
    </button>
  )
}
