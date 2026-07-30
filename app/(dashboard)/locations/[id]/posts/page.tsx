import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Posts · NabaPresence" }

export default function LocationPostsPage() {
  return (
    <CapabilityPlaceholder
      capability="Posts"
      flag="GBP_POSTS_ENABLED"
      enabled={getServerEnv().GBP_POSTS_ENABLED}
      description="Standard updates, events, and offers, drafted and approved before publication to Google."
    />
  )
}
