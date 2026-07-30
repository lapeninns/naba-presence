import type { Metadata } from "next"

import { ResetPasswordView } from "@/components/naba-presence/reset-password-view"

export const metadata: Metadata = {
  title: "Choose a new password — NabaPresence",
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>
}) {
  const params = await searchParams
  return <ResetPasswordView tokenHash={params.token_hash} />
}
