import { createRootRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { Message } from '@ui/States'
import { Bell, FileText, Home, Plus, SearchX, User } from 'lucide-react'
import type { ReactNode } from 'react'

export const Route = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <Message
      icon={<SearchX aria-hidden="true" className="size-10" />}
      title="Esta página no existe"
    >
      <Link to="/" className="font-bold text-brand-deep">
        Ir al inicio
      </Link>
    </Message>
  ),
})

function Shell() {
  // A case opened from a shared link is a page of its own: no app chrome around it.
  const onCasePage = useLocation({ select: (location) => location.pathname.startsWith('/c/') })
  return (
    <>
      <main className={onCasePage ? '' : 'pb-24'}>
        <Outlet />
      </main>
      {onCasePage ? null : <BottomNav />}
    </>
  )
}

function BottomNav() {
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="m-0 mx-auto flex max-w-lg list-none items-end justify-between px-3 py-2">
        <NavItem to="/" icon={<Home aria-hidden="true" />} label="Inicio" />
        <NavItem to="/mis-casos" icon={<FileText aria-hidden="true" />} label="Mis casos" />
        <li>
          <Link
            to="/publicar"
            aria-label="Publicar un aviso"
            className="-mt-6 flex size-16 items-center justify-center rounded-3xl bg-brand text-white shadow-lg"
          >
            <Plus aria-hidden="true" className="size-8" />
          </Link>
        </li>
        <NavItem to="/bandeja" icon={<Bell aria-hidden="true" />} label="Bandeja" />
        <NavItem to="/perfil" icon={<User aria-hidden="true" />} label="Perfil" />
      </ul>
    </nav>
  )
}

function NavItem({
  to,
  icon,
  label,
}: {
  to: '/' | '/mis-casos' | '/bandeja' | '/perfil'
  icon: ReactNode
  label: string
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 text-sm text-muted"
        activeProps={{ className: 'font-bold text-brand-deep' }}
        activeOptions={{ exact: true }}
      >
        {icon}
        {label}
      </Link>
    </li>
  )
}
