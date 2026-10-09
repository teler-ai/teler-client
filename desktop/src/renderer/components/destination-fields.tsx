import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { DestinationScope } from '../../shared/destination'

const SCOPES: { id: DestinationScope; labelKey: string }[] = [
  { id: 'personal', labelKey: 'folders.scopePersonal' },
  { id: 'organization', labelKey: 'folders.scopeOrganization' },
]

interface DestinationFieldsProps {
  scope: DestinationScope
  onScopeChange: (scope: DestinationScope) => void
  name: string
  onNameChange: (name: string) => void
  /** Built destination, or `null` when the name is not a valid segment. */
  destination: string | null
  disabled: boolean
}

export function DestinationFields({
  scope,
  onScopeChange,
  name,
  onNameChange,
  destination,
  disabled,
}: DestinationFieldsProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const hintId = useId()
  const radioName = useId()

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-foreground mb-2 text-sm font-medium">
          {t('addFolder.scopeLegend')}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {SCOPES.map((option) => (
            <label
              key={option.id}
              className="border-border has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-ring flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2"
            >
              <input
                type="radio"
                name={radioName}
                value={option.id}
                checked={scope === option.id}
                onChange={() => onScopeChange(option.id)}
                className="accent-primary size-4"
              />
              {t(option.labelKey)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{t('addFolder.folderName')}</Label>
        <Input
          id={nameId}
          value={name}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={destination === null}
          aria-describedby={hintId}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <p id={hintId} className="text-sm" aria-live="polite">
          {destination === null ? (
            <span className="text-destructive">{t('addFolder.invalidName')}</span>
          ) : (
            <span className="text-muted-foreground">
              {t('addFolder.uploadsTo')}{' '}
              <span className="text-foreground font-data text-xs">{destination}</span>
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
