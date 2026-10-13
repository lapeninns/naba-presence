"use client"

import { Alert, AlertDescription, AlertActions } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

/**
 * One sub-resource of the industry/administration GET is a { data, error }
 * pair. A failing sub-resource shows its own honest panel (never the raw
 * Google error string, per §7); an empty one shows a "nothing set" note;
 * otherwise its editor.
 *
 * Flat, not a card: the panel always sits inside a page section that has
 * its own heading, so a box here would be card-in-card. One hairline above
 * separates it from that heading; the content reads straight on the page.
 * `heading` draws the title inside the panel instead; it is off by default
 * because every caller today already writes its own heading above the
 * panel, and two would read twice.
 */
export function SectionPanel({
  title,
  result,
  children,
  heading = false,
  className,
}: {
  title: string
  result: { data: unknown; error: string | null }
  children: (data: unknown) => React.ReactNode
  /** Render `title` as the panel's own header (an h3 above the hairline). */
  heading?: boolean
  className?: string
}) {
  if (result.error) {
    return <SectionLoadError title={title} className={className} />
  }
  if (result.data == null) {
    return (
      <Empty
        size="sm"
        className={className}
        title={`No ${title.toLowerCase()} set`}
        description="There is nothing to manage here yet."
      />
    )
  }
  return (
    <div
      data-slot="section-panel"
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      {heading ? (
        <h3 className="text-section font-semibold text-ink">{title}</h3>
      ) : null}
      <div className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
        {children(result.data)}
      </div>
    </div>
  )
}

export function SectionLoadError({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <Alert variant="warning" live className={className}>
      <AlertDescription>
        {description ??
          `We couldn't load ${title.toLowerCase()} from Google right now. Try refreshing in a moment.`}
      </AlertDescription>
      {children ? <AlertActions>{children}</AlertActions> : null}
    </Alert>
  )
}
