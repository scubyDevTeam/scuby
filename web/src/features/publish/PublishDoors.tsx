import { useI18n } from '@i18n/react'
import { Notice } from '@ui/Notice'
import { Eye, HeartHandshake, Home, Search } from 'lucide-react'
import type { ReactNode } from 'react'

export type Door = 'lost' | 'found' | 'adoption' | 'help'

// Title and text are read from `publish.doors.<door>`.
const doors: {
  door: Door
  className: string
  icon: ReactNode
  urgent: boolean
}[] = [
  {
    door: 'lost',
    className: 'bg-lost',
    icon: <Search aria-hidden="true" className="size-8" />,
    urgent: true,
  },
  {
    door: 'found',
    className: 'bg-found',
    icon: <Eye aria-hidden="true" className="size-8" />,
    urgent: true,
  },
  {
    door: 'adoption',
    className: 'bg-adoption',
    icon: <Home aria-hidden="true" className="size-8" />,
    urgent: false,
  },
  {
    door: 'help',
    className: 'bg-help',
    icon: <HeartHandshake aria-hidden="true" className="size-8" />,
    urgent: false,
  },
]

/**
 * The four ways in. Only the owner publishes a lost case (docs/product/04 · Publishing): someone
 * who saw or holds an animal goes through «Encontré un animal».
 */
export function PublishDoors({
  link,
}: {
  link: (door: Door, children: ReactNode, className: string) => ReactNode
}) {
  const { t } = useI18n()
  const card = (entry: (typeof doors)[number]) => (
    <li key={entry.door}>
      {link(
        entry.door,
        <>
          {entry.icon}
          <span>
            <span className="block text-xl font-extrabold">
              {t(`publish.doors.${entry.door}.title`)}
            </span>
            <span className="block">{t(`publish.doors.${entry.door}.text`)}</span>
          </span>
        </>,
        `flex min-h-20 items-center gap-4 rounded-2xl p-5 text-white no-underline ${entry.className}`,
      )}
    </li>
  )
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="m-0 text-3xl font-extrabold">{t('publish.doors.title')}</h1>
      <p className="m-0 text-muted">{t('publish.doors.hint')}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {doors.filter((d) => d.urgent).map(card)}
      </ul>
      <h2 className="m-0 mt-2 text-sm font-bold tracking-widest text-muted uppercase">
        {t('publish.doors.not_urgent')}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {doors.filter((d) => !d.urgent).map(card)}
      </ul>
      <Notice title={t('publish.doors.only_saw_title')}>{t('publish.doors.only_saw_body')}</Notice>
    </div>
  )
}
