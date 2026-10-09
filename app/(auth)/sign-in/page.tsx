import { redirect } from "next/navigation"

import { SignInPanel } from "@/components/auth/sign-in-panel"
import { confirmStatusMessage } from "@/lib/api/auth-errors"
import { sanitiseNextPath } from "@/lib/api/next-path"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Sign in · NabaPresence" }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    next?: string
    invite?: string
    mode?: string
  }>
}) {
  const params = await searchParams
  const nextPath = sanitiseNextPath(params.next)
  const session = await getSession()
  if (session) redirect(nextPath ?? "/inbox")
  return (
    <SignInPanel
      initialMode={
        params.mode === "create-account" ? "create-account" : "sign-in"
      }
      inviteToken={params.invite}
      nextPath={nextPath}
      statusMessage={
        params.status ? confirmStatusMessage(params.status) : undefined
      }
    />
  )
}
