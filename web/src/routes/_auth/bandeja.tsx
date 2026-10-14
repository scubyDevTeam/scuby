import { createFileRoute } from '@tanstack/react-router'
import { Message } from '@ui/States'

export const Route = createFileRoute('/_auth/bandeja')({
  component: () => <Message title="Bandeja">Aquí llegarán tus avisos.</Message>,
})
