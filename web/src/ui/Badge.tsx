import type { ReactNode } from 'react'

export type BadgeTone = 'lost' | 'found' | 'adoption' | 'help' | 'info'

const tones: Record<BadgeTone, string> = {
  lost: 'bg-lost text-white',
  found: 'bg-found text-white',
  adoption: 'bg-adoption text-white',
  help: 'bg-help text-white',
  info: 'bg-brand-ice text-ink normal-case tracking-normal',
}

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
