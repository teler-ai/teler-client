import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Building2 } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrganizationSummary } from '../../shared/desktop-api'

interface OrganizationFieldProps {
  organizations: OrganizationSummary[]
  /** Null when the account's organizations are unknown; nothing is shown. */
  value: string | null
  onChange: (id: string) => void
  /** Shown but not changeable: set by the requested project, or while reviewing. */
  fixed: boolean
  disabled: boolean
}

/** Which organization a new folder syncs into: a picker when there is a choice. */
export function OrganizationField({
  organizations,
  value,
  onChange,
  fixed,
  disabled,
}: OrganizationFieldProps) {
  const { t } = useTranslation()
  const triggerId = useId()
  if (value === null) return null

  if (organizations.length > 1 && !fixed) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={triggerId}>{t('addFolder.organization')}</Label>
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={triggerId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const name =
    organizations.find((organization) => organization.id === value)?.name ??
    t('folders.organizationFallback')
  return (
    <div className="flex flex-col gap-1">
      <p className="text-foreground text-sm font-medium">{t('addFolder.organization')}</p>
      <p className="text-foreground flex items-center gap-2 text-sm">
        <Building2 aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
        <span className="min-w-0 break-words">{name}</span>
      </p>
    </div>
  )
}
