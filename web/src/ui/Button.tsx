import type { ComponentProps, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'outline' | 'secondary' | 'whatsapp' | 'danger' | 'link'

const base =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-center text-base font-bold transition-colors disabled:opacity-50'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white active:bg-brand-pressed',
  outline: 'border-2 border-brand-deep bg-surface text-ink active:bg-brand-ice',
  secondary: 'bg-brand-ice text-brand-deep active:bg-brand-mist',
  whatsapp: 'bg-whatsapp text-white active:opacity-90',
  danger: 'bg-lost text-white active:bg-lost-deep',
  link: 'min-h-11 w-auto px-0 text-brand-deep',
}

export function buttonClass(variant: ButtonVariant = 'primary', className = ''): string {
  return `${base} ${variants[variant]} ${className}`
}

/** The square floating button over a photo: back, share. */
export const roundButtonClass =
  'flex size-12 items-center justify-center rounded-2xl bg-surface text-ink shadow-md'

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant
  /** A second, lighter line under the label: «Marca dónde · sin cuenta». */
  hint?: ReactNode
}

export function Button({
  variant,
  hint,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {hint ? (
        <span className="flex flex-col py-2 leading-tight">
          <span className="text-lg">{children}</span>
          <span className="text-sm font-normal opacity-90">{hint}</span>
        </span>
      ) : (
        children
      )}
    </button>
  )
}
