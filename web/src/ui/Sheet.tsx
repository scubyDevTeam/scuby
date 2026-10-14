import { type ReactNode, useEffect, useRef } from 'react'

/** Bottom sheet over the current screen, on the native <dialog> (focus trap and Esc for free). */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
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
      className="m-0 mt-auto w-full max-w-lg rounded-t-3xl p-0 text-ink backdrop:bg-ink/50 sm:mx-auto"
    >
      <div className="flex flex-col gap-4 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 className="m-0 text-xl font-extrabold">{title}</h2>
        {children}
      </div>
    </dialog>
  )
}
