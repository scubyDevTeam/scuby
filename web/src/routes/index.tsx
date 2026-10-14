import { FeedPage } from '@features/feed/FeedPage'
import { createFileRoute, Link } from '@tanstack/react-router'
import { brand } from '../brand'

export const Route = createFileRoute('/')({
  component: () => (
    <FeedPage
      brandName={brand.name}
      caseLink={(code, children) => (
        <Link to="/c/$code" params={{ code }} className="block h-full text-inherit no-underline">
          {children}
        </Link>
      )}
    />
  ),
})
