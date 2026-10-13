import { formatInstant } from "@/components/editors/change-diff"
import { cn } from "@/lib/utils"

/**
 * A stored instant for people: the viewer's local date and time, with the
 * exact machine value in `dateTime` and on hover. The one way this area
 * prints a time, replacing `toLocaleString("en-GB")` (which ignored the
 * viewer's zone conventions and differed from `ReviewTime`).
 */
export function Instant({
  value,
  className,
}: {
  readonly value: string
  readonly className?: string
}) {
  return (
    <time dateTime={value} title={value} className={cn(className)}>
      {formatInstant(value)}
    </time>
  )
}
