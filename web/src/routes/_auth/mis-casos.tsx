import { MyCases } from '@features/mine/MyCases'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_auth/mis-casos')({
  component: () => (
    <MyCases
      caseLink={(code, children, className) => (
        <Link to="/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
      publishLink={(children, className) => (
        <Link to="/publicar" className={className}>
          {children}
        </Link>
      )}
    />
  ),
})
