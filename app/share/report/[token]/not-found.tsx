import { LinkIcon } from "lucide-react"

import { ShareStateCard } from "@/components/share/share-state-card"

/**
 * The one answer for every report link that does not work: mistyped, made
 * up, expired or revoked. Deliberately identical for all of them -- which one
 * it was is not the reader's to learn, and telling them apart would let
 * anyone probing tokens learn which ones once existed. No links into the app.
 */
export default function ShareReportNotFound() {
  return (
    <ShareStateCard
      icon={<LinkIcon />}
      title="This report link isn’t available"
      description="The link may be mistyped, or it may have expired or been switched off. Ask whoever sent it to you for a new one."
    />
  )
}
