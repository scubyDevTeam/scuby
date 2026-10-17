import { useSession } from '@api-client/session'
import { FeedPage } from '@features/feed/FeedPage'
import { withMessages } from '@i18n/locales'
import { createFileRoute, Link } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { brand } from '../../brand'
import { env } from '../../env'

export const Route = createFileRoute('/{-$locale}/')({ component: Home })

// Only a signed-in person can owe an answer: nobody else downloads the banner or its words.
const PendingCheckinBanner = lazy(
  withMessages(['checkin_banner'], () =>
    import('@features/mine/PendingCheckinBanner').then((m) => ({
      default: m.PendingCheckinBanner,
    })),
  ),
)

function Home() {
  const session = useSession()
  return (
    <FeedPage
      banner={
        session.data ? (
          <Suspense fallback={null}>
            <PendingCheckinBanner
              caseLink={(code, children, className) => (
                <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
                  {children}
                </Link>
              )}
            />
          </Suspense>
        ) : null
      }
      brandName={brand.name}
      brandMarkUrl={brand.markUrl}
      mapStyleUrl={env.mapStyleUrl}
      caseLink={(code, children) => (
        <Link
          to="/{-$locale}/c/$code"
          params={{ code }}
          className="block h-full text-inherit no-underline"
        >
          {children}
        </Link>
      )}
    />
  )
}
