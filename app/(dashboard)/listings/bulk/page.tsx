import { notFound } from "next/navigation"
import { Suspense } from "react"

import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame } from "@/components/app-shell/page-frame"
import { BulkCompose } from "@/components/bulk/bulk-compose"
import { bulkActionsEnabled } from "@/lib/server/bulk-listings"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Bulk change · NabaPresence" }

export default async function BulkChangePage() {
  const session = await getSession()
  if (session && session.role !== "owner" && session.role !== "admin") return <AccessDeniedPage area="Bulk changes" />
  // Ships dark: without the organisation's `bulk_actions` feature the page does not exist.
  if (session && !(await bulkActionsEnabled(session.organisationId))) notFound()
  return (
    <PageFrame>
      <Suspense fallback={null}><BulkCompose /></Suspense>
    </PageFrame>
  )
}
