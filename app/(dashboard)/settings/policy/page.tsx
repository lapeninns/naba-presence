import { getSession } from "@/lib/server/session"

import { ReplyPolicyContent } from "../reply-policy-content"

export const metadata = { title: "Reply policy · NabaPresence" }

/**
 * Reply policy at every width: where the phone's settings index and the
 * Reply policy tab lead. /settings shows the same page on a desk.
 */
export default async function SettingsReplyPolicyPage() {
  const session = await getSession()
  return <ReplyPolicyContent session={session} />
}
