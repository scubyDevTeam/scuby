import { useI18n } from '@i18n/react'
import { type ReactNode, useEffect, useRef } from 'react'

/**
 * What a tapped pin shows, over the map it sits on. Not modal — the map stays tappable, a second
 * pin replaces the card — but a labelled dialog that takes the focus when it opens and closes on
 * Escape, so a screen reader announces it and the keyboard can leave it.
 */
export function PinCard({
  label,
  onClose,
  children,
}: {
  /** The dialog's accessible name: the case's title. */
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  // Each new pin moves the focus to its card.
  useEffect(() => {
    if (label) ref.current?.focus()
  }, [label])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      className="relative flex items-center gap-3 rounded-3xl bg-surface p-3 pr-12 text-ink shadow-lg outline-none"
    >
      {children}
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-soft text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}
