import { createFileRoute } from '@tanstack/react-router'
import { Message } from '@ui/States'

export const Route = createFileRoute('/_auth/mis-casos')({
  component: () => <Message title="Mis casos">Aquí verás los avisos que publiques.</Message>,
})
