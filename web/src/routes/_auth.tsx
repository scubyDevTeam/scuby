import { createFileRoute } from '@tanstack/react-router'
import { Message } from '@ui/States'
import { LogIn } from 'lucide-react'

// Session required (frontend.md · Folder structure). Sign-in is not built yet, so nobody has one:
// the guard always shows the gate. It will render <Outlet /> once there is a session to check.
export const Route = createFileRoute('/_auth')({
  component: () => (
    <Message icon={<LogIn aria-hidden="true" className="size-10" />} title="Ingresa para continuar">
      Muy pronto podrás entrar con Google o con tu correo.
    </Message>
  ),
})
