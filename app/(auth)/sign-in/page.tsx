import { redirect } from "next/navigation"

import { SignInAnalytics } from "@/components/auth/sign-in-analytics"
import { SignInPanel } from "@/components/auth/sign-in-panel"
import { confirmStatusMessage } from "@/lib/api/auth-errors"
import { sanitiseNextPath } from "@/lib/api/next-path"
import { getSession } from "@/lib/server/session"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Sign in · NabaPresence" }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    next?: string
    invite?: string
    mode?: string
    email?: string
  }>
}) {
  const params = await searchParams
  const nextPath = sanitiseNextPath(params.next)
  const session = await getSession()
  if (session) redirect(nextPath ?? "/inbox")
  const env = getServerEnv()
  const analyticsId =
    Object.keys(params).length === 0
      ? env.NEXT_PUBLIC_NABA_GA4_MEASUREMENT_ID
      : undefined
  return (
    <SignInPanel
      analytics={
        analyticsId ? <SignInAnalytics measurementId={analyticsId} /> : null
      }
      initialMode={
        params.mode === "create-account" ? "create-account" : "sign-in"
      }
      registrationAllowed={
        env.REGISTRATION_MODE === "open" || Boolean(params.invite)
      }
      workspaceChoice={env.REGISTRATION_WORKSPACE_CHOICE_ENABLED}
      inviteToken={params.invite}
      nextPath={nextPath}
      statusMessage={
        params.status
          ? confirmStatusMessage(
              params.status,
              "sign-in",
              // Only /auth/confirm adds `email=error`: the visitor was
              // opening an email link, so the way on is a new
              // confirmation link or signing in, not a password reset.
              params.email === "error" ? "email-link" : undefined
            )
          : undefined
      }
    />
  )
}
