import { createFileRoute, Link } from '@tanstack/react-router'
import { Message } from '@ui/States'

// The doors whose flow is not built yet. «perdido» has its own route and never lands here.
export const Route = createFileRoute('/publicar/$tipo')({
  component: () => (
    <Message title="Estamos terminando esta parte">
      Por ahora puedes publicar un aviso de mascota perdida.{' '}
      <Link to="/publicar" className="font-bold text-brand-deep">
        Volver
      </Link>
    </Message>
  ),
})
