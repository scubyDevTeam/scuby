import { FeedPage } from '@features/feed/FeedPage'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { brand } from '../brand'
import { env } from '../env'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const navigate = useNavigate()
  return (
    <FeedPage
      brandName={brand.name}
      mapStyleUrl={env.mapStyleUrl}
      caseLink={(code, children) => (
        <Link to="/c/$code" params={{ code }} className="block h-full text-inherit no-underline">
          {children}
        </Link>
      )}
      onOpenCase={(code) => navigate({ to: '/c/$code', params: { code } })}
    />
  )
}
