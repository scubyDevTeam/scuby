import { type ComponentProps, type ReactNode, useId } from 'react'

const inputClass =
  'min-h-12 w-full rounded-2xl border-2 border-field bg-surface px-4 text-base text-ink placeholder:text-muted/70 aria-invalid:border-lost'

type Shell = {
  label: ReactNode
  /** «(opcional)» beside the label. */
  optional?: boolean
  hint?: ReactNode
  error?: string | null
}

function FieldShell({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: Shell & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-bold">
        {label} {optional ? <span className="font-normal text-muted">(opcional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const describedBy = (id: string, shell: Shell) =>
  shell.error ? `${id}-error` : shell.hint ? `${id}-hint` : undefined

export function TextField({
  label,
  optional,
  hint,
  error,
  ...input
}: Shell & Omit<ComponentProps<'input'>, 'id'>) {
  const id = useId()
  const shell = { label, optional, hint, error }
  return (
    <FieldShell id={id} {...shell}>
      <input
        id={id}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, shell)}
        {...input}
      />
    </FieldShell>
  )
}

export function TextArea({
  label,
  optional,
  hint,
  error,
  ...input
}: Shell & Omit<ComponentProps<'textarea'>, 'id'>) {
  const id = useId()
  const shell = { label, optional, hint, error }
  return (
    <FieldShell id={id} {...shell}>
      <textarea
        id={id}
        rows={3}
        className={`${inputClass} py-3`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, shell)}
        {...input}
      />
    </FieldShell>
  )
}

/** National number with the country prefix shown beside it — the user types only their number. */
export function PhoneField({
  prefix,
  label,
  optional,
  hint,
  error,
  ...input
}: Shell & { prefix: string } & Omit<ComponentProps<'input'>, 'id' | 'type'>) {
  const id = useId()
  const shell = { label, optional, hint, error }
  return (
    <FieldShell id={id} {...shell}>
      <div className="flex gap-2">
        <span className="flex min-h-12 items-center rounded-2xl border-2 border-field bg-soft px-4 font-bold">
          {prefix}
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          className={inputClass}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, shell)}
          {...input}
        />
      </div>
    </FieldShell>
  )
}

/** One choice out of a list, each a full-width row with a 44 px target. */
export function RadioList<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string
  name: string
  options: readonly { value: T; label: string }[]
  value: T | null
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 ${
            option.value === value ? 'border-brand bg-brand-ice font-bold' : 'border-transparent'
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="size-5 accent-brand-deep"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

/** A yes/no setting with its explanation, as a switch. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex min-h-12 items-center justify-between gap-4 py-2">
      <span>
        <span className="block font-bold">{label}</span>
        {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="relative h-7 w-12 shrink-0 appearance-none rounded-full bg-field transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-6 before:rounded-full before:bg-surface before:transition-transform checked:bg-brand-deep checked:before:translate-x-5"
      />
    </label>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-6 accent-brand-deep"
      />
      {label}
    </label>
  )
}
