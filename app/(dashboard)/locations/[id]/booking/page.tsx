import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Booking · NabaPresence" }

export default function LocationBookingPage() {
  return (
    <CapabilityPlaceholder
      capability="Booking"
      flag="GBP_PLACE_ACTIONS_ENABLED"
      enabled={getServerEnv().GBP_PLACE_ACTIONS_ENABLED}
      description="The reservation link Google shows for this location, managed through Place Actions."
    />
  )
}
