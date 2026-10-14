import { createFileRoute } from '@tanstack/react-router'
import { Message } from '@ui/States'

export const Route = createFileRoute('/_auth/publicar')({
  component: () => <Message title="Publicar un aviso">Estamos terminando esta parte.</Message>,
})
