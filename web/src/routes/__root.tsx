import { configQuery } from '@api-client/actions'
import { conversationsQuery } from '@api-client/conversations'
import { notificationsQuery } from '@api-client/inbox'
import { queryClient } from '@api-client/query-client'
import { useSession } from '@api-client/session'
import { useI18n } from '@i18n/react'
import { reportError } from '@platform/errors'
import { useQuery } from '@tanstack/react-query'
import { createRootRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { Button } from '@ui/Button'
import { Message } from '@ui/States'
import { Bell, CloudAlert, FileText, Home, Plus, SearchX, User } from 'lucide-react'
import type { ErrorInfo, ReactNode } from 'react'
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
  // No route below sets its own boundary, so whatever breaks a screen lands here.
  errorComponent: Crash,
  // The router's type leaves out the second argument its boundary passes (React's ErrorInfo).
  onCatch: (error: unknown, info?: ErrorInfo) =>
    reportError(error, info?.componentStack ?? undefined),
})

/** A screen threw. Calm words and a way out; the report went with onCatch. */
function Crash() {
  const { t } = useI18n()
  return (
    <Message
      icon={<CloudAlert aria-hidden="true" className="size-10" />}
      title={t('errors_ui.crash.title')}
      action={
        <div className="flex w-full flex-col items-center gap-3">
          <Button onClick={() => window.location.reload()}>{t('errors_ui.crash.reload')}</Button>
          <Link to="/{-$locale}" className="font-bold text-brand-deep">
            {t('errors_ui.crash.home')}
          </Link>
        </div>
      }
    >
      {t('errors_ui.crash.body')}
    </Message>
  )
}

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
        <Link to="/{-$locale}/bandeja" className={`${link} flex items-center gap-2`}>
          {t('app.nav.inbox')}
          <UnreadBadge />
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
          icon={
            <span className="relative">
              <Bell aria-hidden="true" />
              <UnreadBadge className="absolute -top-2 -right-3" spoken={false} />
            </span>
          }
          label={t('app.nav.inbox')}
          // Read after the label: «Bandeja, 2 avisos sin leer».
          after={<UnreadSpoken />}
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

/**
 * The inbox's unread count (alerts and messages), for a signed-in person only: an anonymous visitor has no inbox, so
 * nothing is asked for. Opening the inbox reads what it shows, and the count drops with it.
 */
function useUnreadCount(): number {
  const user = useSession().data
  const inbox = useQuery({ ...notificationsQuery, enabled: Boolean(user) })
  // The bell counts alerts and messages together: both wait in the same tab.
  const messages = useQuery({ ...conversationsQuery, enabled: Boolean(user) })
  return user ? (inbox.data?.unreadCount ?? 0) + (messages.data?.unreadCount ?? 0) : 0
}

/** The red count. `spoken: false` when the words are placed elsewhere, after the label. */
function UnreadBadge({ className = '', spoken = true }: { className?: string; spoken?: boolean }) {
  const count = useUnreadCount()
  if (count === 0) return null
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-lost px-1.5 text-xs leading-5 font-bold text-white ${className}`}
    >
      <span aria-hidden="true">{count}</span>
      {spoken ? <UnreadSpoken /> : null}
    </span>
  )
}

function UnreadSpoken() {
  const { t } = useI18n()
  const count = useUnreadCount()
  if (count === 0) return null
  return <span className="sr-only">{t('inbox.unread_count', { count })}</span>
}

function NavItem({
  to,
  icon,
  label,
  after,
}: {
  to: '/{-$locale}' | '/{-$locale}/mis-casos' | '/{-$locale}/bandeja' | '/{-$locale}/perfil'
  icon: ReactNode
  label: string
  after?: ReactNode
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
        {after}
      </Link>
    </li>
  )
}
