import { useI18n } from '@i18n/react'
import { type ReactNode, useEffect, useRef } from 'react'

/** Bottom sheet over the current screen, on the native <dialog> (focus trap and Esc for free). */
export function Sheet({
  open,
  onClose,
  title,
  size = 'auto',
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** `full` takes the whole phone screen: for a form with a map in it. */
  size?: 'auto' | 'full'
  children: ReactNode
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      onKeyDown={() => {}}
      className={`m-0 mt-auto w-full max-w-lg p-0 text-ink backdrop:bg-ink/50 sm:mx-auto lg:my-auto lg:rounded-3xl ${
        size === 'full'
          ? 'h-dvh max-h-none lg:h-auto lg:max-h-[90dvh]'
          : 'max-h-[90dvh] rounded-t-3xl'
      }`}
    >
      <div className="flex flex-col gap-4 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="m-0 text-2xl font-extrabold">{title}</h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-soft text-xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
