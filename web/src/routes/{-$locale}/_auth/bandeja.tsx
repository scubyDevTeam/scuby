import { Inbox } from '@features/inbox/Inbox'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/{-$locale}/_auth/bandeja')({
  component: () => (
    <Inbox
      caseLink={(code, children, className) => (
        <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
    />
  ),
})
