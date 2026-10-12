import { notFound } from "next/navigation"

import { PageFrame } from "@/components/app-shell/page-frame"
import { BulkOperationView } from "@/components/bulk/bulk-operation-view"
import { bulkActionsEnabled } from "@/lib/server/bulk-listings"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Bulk change · NabaPresence" }

export default async function BulkOperationPage({ params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params
  const session = await getSession()
  if (session && !(await bulkActionsEnabled(session.organisationId))) notFound()
  return (
    <PageFrame>
      <BulkOperationView operationId={operationId} />
    </PageFrame>
  )
}
