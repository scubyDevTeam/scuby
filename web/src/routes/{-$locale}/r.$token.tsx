import { CheckinLinkScreen } from '@features/links/CheckinLinkScreen'
import { createFileRoute, Link } from '@tanstack/react-router'
import { needsWords } from '../-i18n'

// An email button (docs/eng/comms.md · The scanner rule). No session: the token is the auth.
export const Route = createFileRoute('/{-$locale}/r/$token')({
  // Inline, so the route's own params (the token) are still inferred.
  beforeLoad: ({ params }) => needsWords('links')({ params }),
  component: LinkPage,
})

function LinkPage() {
  const { token } = Route.useParams()
  return (
    <CheckinLinkScreen
      token={token}
      caseLink={(code, children, className) => (
        <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
      otherLink={(other, children, className) => (
        <Link to="/{-$locale}/r/$token" params={{ token: other }} className={className}>
          {children}
        </Link>
      )}
      homeLink={(children, className) => (
        <Link to="/{-$locale}" className={className}>
          {children}
        </Link>
      )}
    />
  )
}
