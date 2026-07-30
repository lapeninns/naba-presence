import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Photos · NabaPresence" }

export default function LocationPhotosPage() {
  return (
    <CapabilityPlaceholder
      capability="Photos"
      flag="GBP_MEDIA_ENABLED"
      enabled={getServerEnv().GBP_MEDIA_ENABLED}
      description="Owner and customer media for this location, published to and reconciled with Google."
    />
  )
}
