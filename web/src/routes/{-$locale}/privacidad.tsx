import { LegalPage } from '@features/legal/LegalPage'
import { createFileRoute, Link } from '@tanstack/react-router'
import { brand } from '../../brand'
import { needsWords } from '../-i18n'

export const Route = createFileRoute('/{-$locale}/privacidad')({
  beforeLoad: needsWords('legal'),
  component: Privacy,
})

function Privacy() {
  return (
    <LegalPage
      document="privacy"
      contactEmail={brand.legalEmail}
      otherLink={(children) => (
        <Link to="/{-$locale}/terminos" className="font-bold text-brand-deep">
          {children}
        </Link>
      )}
    />
  )
}
