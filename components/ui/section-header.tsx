import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A section heading row (reference `.section-head`): the heading and a
 * muted one-line description on the left, actions on the right, baseline
 * aligned and wrapping under each other on a narrow container.
 *
 * Props: `title`, `description`, `actions`, `as` (heading level, default
 * h2, sized as the section role; h3 is sized as the title role), `id` (put
 * on the heading so a `section aria-labelledby` can point at it).
 */
function SectionHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  id,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  as?: "h2" | "h3" | "h4"
  id?: string
  className?: string
}) {
  return (
    <div
      data-slot="section-header"
      className={cn(
        "flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1",
        className
      )}
    >
      <div className="flex min-w-0 flex-[1_1_20rem] flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <Heading
          id={id}
          className={cn(
            "font-semibold text-balance text-ink",
            Heading === "h2" ? "text-section" : "text-title"
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p className="text-ui text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

export { SectionHeader }
