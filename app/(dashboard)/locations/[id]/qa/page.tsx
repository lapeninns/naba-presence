import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Q&A · NabaPresence" }

export default function LocationQaPage() {
  return (
    <CapabilityPlaceholder
      capability="Q&A"
      flag="GBP_QA_ENABLED"
      enabled={getServerEnv().GBP_QA_ENABLED}
      description="Questions and owner answers, drafted from verified venue facts and approved before publication."
    />
  )
}
