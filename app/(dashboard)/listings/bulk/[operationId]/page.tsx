import { PageFrame } from "@/components/app-shell/page-frame"
import { BulkOperationView } from "@/components/bulk/bulk-operation-view"

export const metadata = { title: "Bulk change · NabaPresence" }

export default async function BulkOperationPage({ params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params
  return (
    <PageFrame>
      <BulkOperationView operationId={operationId} />
    </PageFrame>
  )
}
