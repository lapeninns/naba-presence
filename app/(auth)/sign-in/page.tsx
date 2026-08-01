import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { SignInForm } from "@/components/auth/sign-in-form"
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
  if (session) redirect(nextPath ?? "/home")
  return (
    <AuthCard
      title="Sign in to NabaPresence"
      description="Google Business Profile is connected separately by an organisation owner, so there is no Google sign-in here."
      footer={
        <a className="underline underline-offset-4" href="/forgot-password">
          Forgot your password?
        </a>
      }
    >
      <SignInForm
        initialMode={params.mode === "create-account" ? "create-account" : "sign-in"}
        inviteToken={params.invite}
        nextPath={nextPath}
        statusMessage={
          params.status ? confirmStatusMessage(params.status) : undefined
        }
      />
    </AuthCard>
  )
}
