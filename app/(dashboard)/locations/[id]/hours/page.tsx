import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"

export const metadata = { title: "Hours · NabaPresence" }

export default function LocationHoursPage() {
  return (
    <CapabilityPlaceholder
      capability="Hours"
      flag="GBP_PROFILE_WRITES_ENABLED"
      enabled={false}
      description="Regular, special, and additional opening hours, compared against the canonical schedule and published to Google."
    />
  )
}
