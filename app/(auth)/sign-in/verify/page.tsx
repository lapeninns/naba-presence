import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { MfaVerifyForm } from "@/components/auth/mfa-verify-form"
import { sanitiseNextPath } from "@/lib/api/next-path"
import { isMfaEnabled } from "@/lib/server/mfa"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Enter your code · NabaPresence" }

/**
 * The code step of signing in (P02-S8). Reached after a correct password,
 * a password reset or an emailed link, for a person with two-step
 * verification; the pending sign-in itself is in an httpOnly cookie that
 * only `/api/auth/mfa/**` reads.
 */
export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const nextPath = sanitiseNextPath((await searchParams).next)
  if (!isMfaEnabled()) redirect("/sign-in")
  if (await getSession()) redirect(nextPath ?? "/inbox")
  return (
    <AuthCard
      eyebrow="Two-step verification"
      title="Enter your code"
      description="Open your authenticator app and enter the 6-digit code it shows for NabaPresence."
    >
      <MfaVerifyForm nextPath={nextPath} />
    </AuthCard>
  )
}
