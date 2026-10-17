import { ApiError } from '@api-client/http'
import { useCheckinLink, useConfirmCheckinLink } from '@api-client/links'
import type { CheckinLink, LinkResponse } from '@contracts/links'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Button, type ButtonVariant } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { Message, Skeleton } from '@ui/States'
import { CircleCheck, Clock, PawPrint, SearchX, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

type Consequential = Extract<
  LinkResponse,
  'reunited' | 'delete' | 'claim_confirmed' | 'claim_dismissed' | 'adopted' | 'no_longer_needed'
>

const confirmVariant: Record<Consequential, ButtonVariant> = {
  reunited: 'primary',
  delete: 'danger',
  claim_confirmed: 'primary',
  claim_dismissed: 'primary',
  adopted: 'primary',
  no_longer_needed: 'primary',
}

const isConsequential = (response: LinkResponse): response is Consequential =>
  response in confirmVariant

type Props = {
  token: string
  /** A link to the case, styled by the caller's class. */
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
  /** A link to another button of the same email (`/r/<token>`): backing out answers too. */
  otherLink: (token: string, children: ReactNode, className: string) => ReactNode
  homeLink: (children: ReactNode, className: string) => ReactNode
}

/**
 * Where an email button lands (docs/eng/comms.md · The scanner rule). A safe answer was applied by
 * opening the link and thanks; a consequential one asks once, and only the tap acts.
 */
export function CheckinLinkScreen({ token, caseLink, otherLink, homeLink }: Props) {
  const { t } = useI18n()
  const link = useCheckinLink(token)

  if (link.isPending) {
    return (
      <div
        className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 py-16"
        role="status"
        aria-label={t('links.loading')}
      >
        <Skeleton className="size-32 rounded-full" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-6 w-full" />
      </div>
    )
  }

  if (link.isError) {
    if (link.error instanceof ApiError && link.error.kind === 'not_found') {
      return (
        <Message
          icon={<SearchX aria-hidden="true" className="size-10" />}
          title={t('links.not_found_title')}
          action={homeLink(t('links.go_home'), 'font-bold text-brand-deep')}
        >
          {t('links.not_found_body')}
        </Message>
      )
    }
    return (
      <Message
        icon={<WifiOff aria-hidden="true" className="size-10" />}
        title={t('links.load_failed')}
        action={<Button onClick={() => link.refetch()}>{t('common.retry')}</Button>}
      >
        {t('common.check_connection')}
      </Message>
    )
  }

  return <LinkState link={link.data} token={token} caseLink={caseLink} otherLink={otherLink} />
}

function LinkState({
  link,
  token,
  caseLink,
  otherLink,
}: {
  link: CheckinLink
  token: string
  caseLink: Props['caseLink']
  otherLink: Props['otherLink']
}) {
  const { t } = useI18n()
  const confirm = useConfirmCheckinLink(token)
  const name = link.petName ?? t('links.unnamed')
  const viewCase = caseLink(
    link.caseCode,
    t(`links.view_case.${link.vertical}`),
    'inline-flex min-h-12 w-full items-center justify-center rounded-2xl border-2 border-brand-deep bg-surface px-5 font-bold text-ink no-underline',
  )

  if (link.state === 'confirm' && isConsequential(link.response)) {
    const response = link.response
    return (
      <Card photoUrl={link.photoUrl}>
        <Heading
          title={t(`links.confirm.${response}.title`, { name })}
          body={t(`links.confirm.${response}.body`, { name })}
        />
        <div className="mt-auto flex w-full flex-col items-center gap-3">
          {confirm.isError ? (
            <Notice tone="warning" title={t('links.confirm_failed')}>
              {t('common.try_again')}
            </Notice>
          ) : null}
          <Button
            variant={confirmVariant[response]}
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {t(`links.confirm.${response}.button`, { name })}
          </Button>
          {link.declineToken
            ? otherLink(
                link.declineToken,
                t(`links.confirm.${response}.decline`, { name }),
                'min-h-11 font-bold text-muted no-underline',
              )
            : null}
        </div>
      </Card>
    )
  }

  const outcome: Record<
    Exclude<CheckinLink['state'], 'confirm'>,
    { title: TextKey; body: TextKey; icon: ReactNode }
  > = {
    applied: {
      title: `links.thanks.${link.response}.title`,
      body: `links.thanks.${link.response}.body`,
      icon: null,
    },
    used: {
      title: 'links.used.title',
      body: 'links.used.body',
      icon: <CircleCheck aria-hidden="true" className="size-8 text-found" />,
    },
    already_answered: {
      title: 'links.already_answered.title',
      body: 'links.already_answered.body',
      icon: <CircleCheck aria-hidden="true" className="size-8 text-brand" />,
    },
    expired: {
      title: 'links.expired.title',
      body: 'links.expired.body',
      icon: <Clock aria-hidden="true" className="size-8 text-muted" />,
    },
  }
  const shown = outcome[link.state === 'confirm' ? 'applied' : link.state]
  return (
    <Card photoUrl={link.photoUrl}>
      {shown.icon}
      <Heading title={t(shown.title, { name })} body={t(shown.body, { name })} />
      <div className="mt-auto w-full">{viewCase}</div>
    </Card>
  )
}

function Card({ photoUrl, children }: { photoUrl: string | null; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center gap-4 px-6 py-10 text-center">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="size-32 rounded-full object-cover" />
      ) : (
        <span className="flex size-32 items-center justify-center rounded-full bg-soft text-muted">
          <PawPrint aria-hidden="true" className="size-12" />
        </span>
      )}
      {children}
    </div>
  )
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="m-0 text-3xl font-extrabold">{title}</h1>
      <p className="m-0 text-lg text-muted">{body}</p>
    </>
  )
}
