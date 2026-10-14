import { MyCases } from '@features/mine/MyCases'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/{-$locale}/_auth/mis-casos')({
  component: () => (
    <MyCases
      caseLink={(code, children, className) => (
        <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
      publishLink={(children, className) => (
        <Link to="/{-$locale}/publicar" className={className}>
          {children}
        </Link>
      )}
    />
  ),
})
