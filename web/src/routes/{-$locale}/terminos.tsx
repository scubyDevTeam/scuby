import { LegalPage } from '@features/legal/LegalPage'
import { createFileRoute, Link } from '@tanstack/react-router'
import { brand } from '../../brand'
import { needsWords } from '../-i18n'

export const Route = createFileRoute('/{-$locale}/terminos')({
  beforeLoad: needsWords('legal'),
  component: Terms,
})

function Terms() {
  return (
    <LegalPage
      document="terms"
      contactEmail={brand.legalEmail}
      otherLink={(children) => (
        <Link to="/{-$locale}/privacidad" className="font-bold text-brand-deep">
          {children}
        </Link>
      )}
    />
  )
}
