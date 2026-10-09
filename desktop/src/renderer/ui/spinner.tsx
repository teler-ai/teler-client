import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

interface SpinnerProps {
  /** Announced as a status; without it the spinner is decorative. */
  label?: string
  size?: 'sm' | 'lg'
  className?: string
}

/** A loading indicator; it stands still when the user prefers reduced motion. */
export function Spinner({ label, size = 'sm', className }: SpinnerProps) {
  const icon = (
    <Loader2
      aria-hidden="true"
      className={cn(
        'motion-safe:animate-spin',
        size === 'lg' ? 'size-8' : 'size-4',
        !label && className
      )}
    />
  )
  if (!label) return icon
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  )
}
