"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { LISTING_TERMS, workspaceTerms } from "@/lib/workspace/terms"

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
 * lookup-found-nothing drawing.
 */
export function NotInDirectory({ kind }: { kind: "client" | "location" }) {
  const mode = useWorkspaceMode()
  const business = mode === "business"
  const terms = workspaceTerms(mode)
  return (
    <div data-slot="not-in-directory" className="flex flex-1 flex-col">
      <Empty
        titleAs="h2"
        placement="page"
        illustration={<EmptyIllustration name="search" />}
        title={
          kind === "client"
            ? "This client isn’t in your directory"
            : `This ${LISTING_TERMS.place} isn’t in your directory`
        }
        description={
          business
            ? "It may have been removed, or you may not have access to it. Nothing is reported for it."
            : "It may have been removed, or it belongs to a client you can’t see. Nothing is reported for it."
        }
        action={
          <Link
            href="/reports"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            {`All ${terms.scopePlural}`}
          </Link>
        }
      />
    </div>
  )
}
