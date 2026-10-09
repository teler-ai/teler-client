import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { useId, type ReactNode } from 'react'

interface SectionCardProps {
  title: string
  /** Optional control aligned with the section title. */
  action?: ReactNode
  children: ReactNode
}

/** A titled settings section; the heading names the region for assistive tech. */
export function SectionCard({ title, action, children }: SectionCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <Card className="gap-4 py-5">
        <CardHeader className="flex items-center justify-between gap-3 px-5">
          <CardTitle>
            <h2 id={headingId} className="text-lg">
              {title}
            </h2>
          </CardTitle>
          {action}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-5">{children}</CardContent>
      </Card>
    </section>
  )
}
