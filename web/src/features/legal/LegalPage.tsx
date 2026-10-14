import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Notice } from '@ui/Notice'
import type { ReactNode } from 'react'

// docs/product/03 · What we must ship at launch: an intermediary ToS and the Ley 1581 data policy.
// Drafts until the one lawyer review — the page says so.
const SECTIONS = {
  terms: [
    ['legal.terms.intermediary_title', 'legal.terms.intermediary_body'],
    ['legal.terms.adoption_title', 'legal.terms.adoption_body'],
    ['legal.terms.money_title', 'legal.terms.money_body'],
    ['legal.terms.badges_title', 'legal.terms.badges_body'],
    ['legal.terms.content_title', 'legal.terms.content_body'],
    ['legal.terms.account_title', 'legal.terms.account_body'],
    ['legal.terms.care_title', 'legal.terms.care_body'],
    ['legal.terms.liability_title', 'legal.terms.liability_body'],
    ['legal.terms.changes_title', 'legal.terms.changes_body'],
  ],
  privacy: [
    ['legal.privacy.controller_title', 'legal.privacy.controller_body'],
    ['legal.privacy.data_title', 'legal.privacy.data_body'],
    ['legal.privacy.purpose_title', 'legal.privacy.purpose_body'],
    ['legal.privacy.shown_title', 'legal.privacy.shown_body'],
    ['legal.privacy.sharing_title', 'legal.privacy.sharing_body'],
    ['legal.privacy.retention_title', 'legal.privacy.retention_body'],
    ['legal.privacy.rights_title', 'legal.privacy.rights_body'],
    ['legal.privacy.consent_title', 'legal.privacy.consent_body'],
  ],
} as const satisfies Record<string, readonly (readonly [TextKey, TextKey])[]>

export type LegalDocument = keyof typeof SECTIONS

const HEADINGS = {
  terms: ['legal.terms.title', 'legal.terms.intro'],
  privacy: ['legal.privacy.title', 'legal.privacy.intro'],
} as const satisfies Record<LegalDocument, readonly [TextKey, TextKey]>

type Props = {
  document: LegalDocument
  /** Where consultas and reclamos go; until it is configured the page says one is coming. */
  contactEmail: string | undefined
  /** The link to the other document; the router lives in `routes`. */
  otherLink: (children: ReactNode) => ReactNode
}

export function LegalPage({ document, contactEmail, otherLink }: Props) {
  const { t, rich } = useI18n()
  const [title, intro] = HEADINGS[document]
  const other = document === 'terms' ? 'legal.privacy.title' : 'legal.terms.title'
  const contact = contactEmail ? (
    <a href={`mailto:${contactEmail}`} className="font-bold text-brand-deep">
      {contactEmail}
    </a>
  ) : (
    t('legal.contact_pending')
  )

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-3xl font-extrabold">{t(title)}</h1>
        <p className="m-0 text-lg text-muted">{t(intro)}</p>
      </header>
      <Notice tone="warning" title={t('legal.draft_title')}>
        {t('legal.draft_body')}
      </Notice>
      {SECTIONS[document].map(([heading, body]) => (
        <section key={heading} className="flex flex-col gap-2">
          <h2 className="m-0 text-xl font-extrabold">{t(heading)}</h2>
          <p className="m-0 leading-relaxed">{rich(body, { contact })}</p>
        </section>
      ))}
      <p className="m-0 text-muted">
        {rich('legal.other_document', { name: otherLink(t(other)) })}
      </p>
    </article>
  )
}
