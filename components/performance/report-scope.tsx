"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { LISTING_TERMS } from "@/lib/workspace/terms"

/** What the way back keeps: the tab and each tab's period, never the bad id. */
const KEPT_PARAMS = ["tab", "range", "range_kw"] as const

/*
 * The scope bar that used to live here (ReportScope) is now the one
 * `ReportToolbar` row (components/reporting/report-toolbar), shared by the
 * reports and a single location's report.
 */

/**
 * A `?clientId=` or `?locationId=` that is not in the viewer's directory
 * (removed, or a client they cannot see). Nothing is reported for it; there
 * is no fallback to some other client.
 *
 * It is all the page shows under its title, so it is a page-placed empty
 * state (no card, sitting at about a third of the height) with the
 * lookup-found-nothing drawing. The way back keeps the tab and period, so
 * the reader lands on the report they asked for, for everything they can see.
 */
export function NotInDirectory({ kind }: { kind: "client" | "location" }) {
  const business = useWorkspaceMode() === "business"
  const searchParams = useSearchParams()
  const back = new URLSearchParams()
  for (const name of KEPT_PARAMS) {
    const value = searchParams.get(name)
    if (value) back.set(name, value)
  }
  const query = back.toString()
  return (
    <div data-slot="not-in-directory" className="flex flex-1 flex-col">
      <Empty
        titleAs="h2"
        placement="page"
        illustration={<EmptyIllustration name="search" />}
        title={
          kind === "client"
            ? "We can’t find this client"
            : `We can’t find this ${LISTING_TERMS.place}`
        }
        description={
          business || kind === "client"
            ? "It may have been removed, or you may not have access to it. No figures are shown for it."
            : "It may have been removed, or it belongs to a client you can’t see. No figures are shown for it."
        }
        action={
          <Link
            href={query ? `/reports?${query}` : "/reports"}
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            {business
              ? `Show all ${LISTING_TERMS.placePlural}`
              : "Show all clients"}
          </Link>
        }
      />
    </div>
  )
}
