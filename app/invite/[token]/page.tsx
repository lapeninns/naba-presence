import type { Metadata } from "next"

import { InvitationView } from "@/components/naba-presence/invitation-view"

export const metadata: Metadata = {
  title: "Accept invitation — NabaPresence",
}

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <InvitationView token={token} />
}
