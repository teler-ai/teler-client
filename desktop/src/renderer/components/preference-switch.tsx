import { Switch } from '../ui/switch'
import { useId, useState } from 'react'

interface PreferenceSwitchProps {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => Promise<void>
}

/** A labelled switch with a hint; disabled while its change is in flight. */
export function PreferenceSwitch({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: PreferenceSwitchProps) {
  const labelId = useId()
  const hintId = useId()
  const [pending, setPending] = useState(false)

  const toggle = async (next: boolean) => {
    setPending(true)
    try {
      await onChange(next)
    } catch {
      // The pushed state keeps the switch truthful when the change fails.
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span id={labelId} className="text-foreground text-sm font-medium">
          {label}
        </span>
        <span id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </span>
      </div>
      <Switch
        className="mt-0.5"
        checked={checked}
        disabled={disabled || pending}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onCheckedChange={(next) => void toggle(next)}
      />
    </div>
  )
}
