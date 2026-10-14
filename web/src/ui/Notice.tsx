import type { ReactNode } from 'react'

export type NoticeTone = 'info' | 'success' | 'warning' | 'neutral'

const tones: Record<NoticeTone, string> = {
  info: 'bg-brand-ice text-ink',
  success: 'bg-found text-white',
  warning: 'bg-lost-soft text-lost-ink',
  neutral: 'bg-soft text-ink',
}

export function Notice({
  tone = 'info',
  icon,
  title,
  children,
}: {
  tone?: NoticeTone
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={`flex gap-3 rounded-2xl p-4 ${tones[tone]}`} role="status">
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <p className="m-0">
        {title ? <strong>{title} </strong> : null}
        {children}
      </p>
    </div>
  )
}
