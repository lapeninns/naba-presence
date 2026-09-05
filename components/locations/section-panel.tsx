"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

/**
 * One sub-resource of the industry/administration GET is a { data, error }
 * pair. A failing sub-resource shows its own honest panel (never the raw
 * Google error string, per §7); an empty one shows a "nothing set" note;
 * otherwise its editor, on a plain card.
 *
 * The card is the grouped-background kind: white on the canvas, no border,
 * no shadow. `heading` draws the title inside the card as a hairline-separated
 * header; it is off by default because every caller today already writes its
 * own heading above the panel, and two would read twice.
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
  /** Render `title` as the card's own header (an h3 over a hairline). */
  heading?: boolean
  className?: string
}) {
  if (result.error) {
    return (
      <Alert variant="warning" className={className}>
        <AlertDescription>
          We couldn&apos;t load {title.toLowerCase()} from Google right now. Try
          refreshing in a moment.
        </AlertDescription>
      </Alert>
    )
  }
  if (result.data == null) {
    return (
      <Empty
        className={cn("rounded-(--np-radius-card) bg-surface", className)}
        title={`No ${title.toLowerCase()} set`}
        description="There is nothing to manage here yet."
      />
    )
  }
  return (
    <div
      data-slot="section-panel"
      className={cn(
        "flex flex-col rounded-(--np-radius-card) bg-surface",
        className
      )}
    >
      {heading ? (
        <h3 className="border-b border-line-subtle px-(--np-card-pad) py-3 text-title font-semibold text-ink">
          {title}
        </h3>
      ) : null}
      <div className="flex flex-col gap-4 p-(--np-card-pad)">
        {children(result.data)}
      </div>
    </div>
  )
}
