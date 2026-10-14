import { type Door, PublishDoors } from '@features/publish/PublishDoors'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/{-$locale}/publicar/')({ component: Doors })

const slug: Record<Door, string> = {
  lost: 'perdido',
  found: 'encontrado',
  adoption: 'adopcion',
  help: 'ayuda',
}

// Choosing a door needs no account: the sign-in appears at the first step that does.
function Doors() {
  return (
    <PublishDoors
      link={(door, children, className) => (
        <Link to="/{-$locale}/publicar/$tipo" params={{ tipo: slug[door] }} className={className}>
          {children}
        </Link>
      )}
    />
  )
}
