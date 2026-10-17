import { useI18n } from '@i18n/react'
import type { ReactNode } from 'react'

export type InboxTab = 'notices' | 'messages'

type Props = {
  current: InboxTab
  /** A link to the other tab, from the router; the current one is plain text. */
  tabLink: (tab: InboxTab, children: ReactNode, className: string) => ReactNode
}

const base =
  'flex min-h-11 flex-1 items-center justify-center rounded-xl px-4 font-bold no-underline'

/** «Avisos · Mensajes»: the two halves of the inbox. */
export function InboxTabs({ current, tabLink }: Props) {
  const { t } = useI18n()
  const tabs: [InboxTab, string][] = [
    ['notices', t('chat.tab_notices')],
    ['messages', t('chat.tab_messages')],
  ]
  return (
    <nav aria-label={t('chat.tabs_label')} className="flex gap-1 rounded-2xl bg-soft p-1">
      {tabs.map(([tab, label]) =>
        tabLink(
          tab,
          label,
          `${base} ${tab === current ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`,
        ),
      )}
    </nav>
  )
}
