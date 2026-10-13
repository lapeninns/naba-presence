"use client"

import { SearchXIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/*
 * The scope bar that used to live here (ReportScope) is now the one
 * `ReportToolbar` row (components/reporting/report-toolbar), shared by the
 * reports and a single location's report.
 */

/**
 * A `?clientId=` or `?locationId=` that is not in the viewer's directory
 * (removed, or a client they cannot see). Nothing is reported for it; there
 * is no fallback to some other client.
 */
export function NotInDirectory({ kind }: { kind: "client" | "location" }) {
  const business = useWorkspaceMode() === "business"
  return (
    <Card data-slot="not-in-directory" flush>
      <Empty
        titleAs="h2"
        icon={<SearchXIcon />}
        title={
          kind === "client"
            ? "This client isn’t in your directory"
            : "This location isn’t in your directory"
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
            {business ? "All locations" : "All clients"}
          </Link>
        }
      />
    </Card>
  )
}
