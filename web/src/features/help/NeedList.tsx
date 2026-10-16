import type { HelpCase, HelpNeed, MyPledge } from '@contracts/help-case'
import { acceptsPledges } from '@domain/help/needs'
import { useI18n } from '@i18n/react'
import { Badge } from '@ui/Badge'
import { Button } from '@ui/Button'
import { Car, Home, Package } from 'lucide-react'
import type { ReactNode } from 'react'
import { neededByLine, needProgressLine } from './copy'

const icons = { foster: Home, transport: Car, supplies: Package } as const

type Props = {
  request: HelpCase
  /** «Yo ayudo con esto» on a need, or null where the viewer cannot offer (the beneficiary). */
  onOffer: ((need: HelpNeed) => void) | null
  /** The viewer's own pledges, shown under the need they are for. */
  mine: (pledges: MyPledge[]) => ReactNode
}

/** Each need says exactly what is asked and how far it got (docs/product/07 · `help_need`). */
export function NeedList({ request, onOffer, mine }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <ul aria-label={t('help.page.needs_title')} className="m-0 flex list-none flex-col gap-3 p-0">
      {request.needs.map((need) => {
        const Icon = icons[need.kind]
        const kind = t(`help.need.kind.${need.kind}`)
        const own = request.myPledges.filter((pledge) => pledge.needId === need.id)
        const offering = own.some((pledge) => pledge.status === 'pledged')
        return (
          <li
            key={need.id}
            aria-label={kind}
            className={`flex flex-col gap-2 rounded-2xl border-2 p-4 ${
              need.status === 'open' ? 'border-help' : 'border-line opacity-80'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Icon aria-hidden="true" className="size-6 shrink-0 text-help" />
              <h3 className="m-0 text-xl font-extrabold">{kind}</h3>
              {need.status !== 'open' ? (
                <Badge tone={need.status === 'covered' ? 'found' : 'info'}>
                  {t(`help.need.${need.status}`)}
                </Badge>
              ) : null}
            </div>
            <p className="m-0 text-lg">{need.detail}</p>
            {need.neededBy ? (
              <p className="m-0 font-semibold">{neededByLine(i18n, need.neededBy)}</p>
            ) : null}
            <p className="m-0 text-muted">{needProgressLine(i18n, need)}</p>
            {mine(own)}
            {onOffer && !offering && acceptsPledges(need.status, need) ? (
              <Button variant="outline" onClick={() => onOffer(need)}>
                {t('help.need.offer')}
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
