// The three states every screen has besides its content: loading, empty, error.
import type { ReactNode } from 'react'

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-soft ${className}`} />
}

export function Message({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-16 text-center">
      {icon ? <span className="text-brand">{icon}</span> : null}
      <h1 className="m-0 text-2xl font-extrabold">{title}</h1>
      {children ? <p className="m-0 text-muted">{children}</p> : null}
      {action}
    </div>
  )
}
