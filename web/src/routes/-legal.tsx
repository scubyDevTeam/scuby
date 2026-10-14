// The consent line under every sign-in and publish step (docs/product/03 · Ley 1581: consent at
// signup), with both documents a tap away. They open in a new tab so a half-done form survives.
import { useI18n } from '@i18n/react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

const linkClass = 'font-bold text-brand-deep'

export function LegalLine() {
  const { rich } = useI18n()
  return (
    <>
      {rich('app.legal', {
        terms: (chunks: ReactNode) => (
          <Link to="/{-$locale}/terminos" target="_blank" className={linkClass}>
            {chunks}
          </Link>
        ),
        privacy: (chunks: ReactNode) => (
          <Link to="/{-$locale}/privacidad" target="_blank" className={linkClass}>
            {chunks}
          </Link>
        ),
      })}
    </>
  )
}
