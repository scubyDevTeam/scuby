// Single-choice controls: filter chips (one per vertical) and the segmented switch.
import type { ReactNode } from 'react'

export type Option<T extends string> = { value: T; label: ReactNode; className?: string }

type ChoiceProps<T extends string> = {
  label: string
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
}

export function Chips<T extends string>({ label, options, value, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-full border px-4 text-base font-semibold ${
              selected
                ? 'border-brand bg-brand text-white'
                : `border-line bg-surface ${option.className ?? 'text-ink'}`
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}

export function Segmented<T extends string>({ label, options, value, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="m-0 flex rounded-xl border-0 bg-soft p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-11 flex-1 rounded-lg px-3 text-base font-semibold ${
              selected ? 'bg-surface text-ink shadow-sm' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}
