import { createRootRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { Message } from '@ui/States'
import { Bell, FileText, Home, Plus, SearchX, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { brand } from '../brand'

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
      <TopBar />
      <main className={onCasePage ? '' : 'pb-24 lg:pb-0'}>
        <Outlet />
      </main>
      {onCasePage ? null : <BottomNav />}
    </>
  )
}

/** Desktop chrome. Phones get the bottom bar instead, and nothing at all on a case page. */
function TopBar() {
  const link = 'rounded-xl px-3 py-2 font-semibold text-white no-underline hover:bg-white/15'
  return (
    <header className="sticky top-0 z-10 hidden bg-brand text-white lg:block">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-8 py-4">
        <Link
          to="/"
          className="mr-auto flex items-center gap-3 text-2xl font-extrabold text-white no-underline"
        >
          <img src={brand.markUrl} alt="" className="h-10 w-auto" />
          {brand.name}
        </Link>
        <Link to="/mis-casos" className={link}>
          Mis casos
        </Link>
        <Link to="/bandeja" className={link}>
          Bandeja
        </Link>
        <Link
          to="/publicar"
          className="mx-2 rounded-full bg-surface px-6 py-3 font-bold text-brand-deep no-underline"
        >
          Publicar aviso
        </Link>
        <Link to="/perfil" className={link}>
          Entrar
        </Link>
      </div>
    </header>
  )
}

function BottomNav() {
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
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
