import { configQuery } from '@api-client/actions'
import { queryClient } from '@api-client/query-client'
import { useSession } from '@api-client/session'
import { useI18n } from '@i18n/react'
import { createRootRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { Message } from '@ui/States'
import { Bell, FileText, Home, Plus, SearchX, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { brand } from '../brand'
import { LanguageLinks } from './-i18n'

export const Route = createRootRoute({
  // Every form that takes a phone needs the country row. Asked for at once, alongside whatever the
  // page itself loads, and not awaited: the case page must not wait on it to paint.
  loader: () => {
    void queryClient.prefetchQuery(configQuery)
  },
  component: Shell,
  notFoundComponent: NotFound,
})

function NotFound() {
  const { t } = useI18n()
  return (
    <Message
      icon={<SearchX aria-hidden="true" className="size-10" />}
      title={t('app.not_found.title')}
    >
      <Link to="/{-$locale}" className="font-bold text-brand-deep">
        {t('app.not_found.home')}
      </Link>
    </Message>
  )
}

function Shell() {
  // A case opened from a shared link is a page of its own: no app chrome around it.
  const onCasePage = Boolean(useMatchRoute()({ to: '/{-$locale}/c/$code' }))
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
  const { t } = useI18n()
  const user = useSession().data
  const link = 'rounded-xl px-3 py-2 font-semibold text-white no-underline hover:bg-white/15'
  return (
    <header className="sticky top-0 z-10 hidden bg-brand text-white lg:block">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-8 py-4">
        <Link
          to="/{-$locale}"
          className="mr-auto flex items-center gap-3 text-2xl font-extrabold text-white no-underline"
        >
          <img src={brand.markUrl} alt="" className="h-10 w-auto" />
          {brand.name}
        </Link>
        <Link to="/{-$locale}/mis-casos" className={link}>
          {t('app.nav.my_cases')}
        </Link>
        <Link to="/{-$locale}/bandeja" className={link}>
          {t('app.nav.inbox')}
        </Link>
        <Link
          to="/{-$locale}/publicar"
          className="mx-2 rounded-full bg-surface px-6 py-3 font-bold text-brand-deep no-underline"
        >
          {t('app.nav.publish')}
        </Link>
        <Link to="/{-$locale}/perfil" className={link}>
          {user ? user.displayName : t('app.nav.sign_in')}
        </Link>
        <LanguageLinks className={link} />
      </div>
    </header>
  )
}

function BottomNav() {
  const { t } = useI18n()
  return (
    <nav
      aria-label={t('app.nav.label')}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="m-0 mx-auto flex max-w-lg list-none items-end justify-between px-3 py-2">
        <NavItem to="/{-$locale}" icon={<Home aria-hidden="true" />} label={t('app.nav.home')} />
        <NavItem
          to="/{-$locale}/mis-casos"
          icon={<FileText aria-hidden="true" />}
          label={t('app.nav.my_cases')}
        />
        <li>
          <Link
            to="/{-$locale}/publicar"
            aria-label={t('app.nav.publish_label')}
            className="-mt-6 flex size-16 items-center justify-center rounded-3xl bg-brand text-white shadow-lg"
          >
            <Plus aria-hidden="true" className="size-8" />
          </Link>
        </li>
        <NavItem
          to="/{-$locale}/bandeja"
          icon={<Bell aria-hidden="true" />}
          label={t('app.nav.inbox')}
        />
        <NavItem
          to="/{-$locale}/perfil"
          icon={<User aria-hidden="true" />}
          label={t('app.nav.profile')}
        />
      </ul>
    </nav>
  )
}

function NavItem({
  to,
  icon,
  label,
}: {
  to: '/{-$locale}' | '/{-$locale}/mis-casos' | '/{-$locale}/bandeja' | '/{-$locale}/perfil'
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
