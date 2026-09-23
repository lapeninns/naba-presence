import { SearchXIcon } from "lucide-react"
import Link from "next/link"
import type * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

/**
 * The scope bar above a report (reference `.card.scope`): a round mark, who
 * the figures are for and a one-line caption on the left, the controls on
 * the right. The controls wrap under the name, and each takes the full row
 * on a phone.
 */
export function ReportScope({
  icon,
  title,
  caption,
  controls,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  caption: React.ReactNode
  controls?: React.ReactNode
}) {
  return (
    <section
      aria-label="Reporting scope"
      data-slot="report-scope"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-(--np-radius-card) border border-line bg-surface p-4"
    >
      <div className="flex min-w-0 flex-[1_1_17.5rem] items-center gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-secondary [&_svg]:size-4 [&_svg]:[stroke-width:1.75]"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-ui font-semibold break-words text-ink">{title}</p>
          <p className="text-caption break-words text-ink-muted">{caption}</p>
        </div>
      </div>
      {controls ? (
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          {controls}
        </div>
      ) : null}
    </section>
  )
}

/**
 * A `?clientId=` or `?locationId=` that is not in the viewer's directory
 * (removed, or a client they cannot see). Nothing is reported for it; there
 * is no fallback to some other client.
 */
export function NotInDirectory({ kind }: { kind: "client" | "location" }) {
  return (
    <div
      data-slot="not-in-directory"
      className="rounded-(--np-radius-card) border border-line bg-surface"
    >
      <Empty
        titleAs="h2"
        icon={<SearchXIcon />}
        title={
          kind === "client"
            ? "This client isn’t in your directory"
            : "This location isn’t in your directory"
        }
        description="It may have been removed, or it belongs to a client you can’t see. Nothing is reported for it."
        action={
          <Link
            href="/reports"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All clients
          </Link>
        }
      />
    </div>
  )
}
