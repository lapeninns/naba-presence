import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app-shell/page-frame"
import { SettingsNav } from "@/components/settings/settings-nav"
import { TwoStepVerificationCard } from "@/components/settings/two-step-verification-card"
import { isMfaEnabled } from "@/lib/server/mfa"
import { requireSession } from "@/lib/server/session"

export const metadata = { title: "Sign-in security · NabaPresence" }

/** Two-step verification for the signed-in person (P02-S8, MFA_ENABLED). */
export default async function SettingsSecurityPage() {
  if (!isMfaEnabled()) notFound()
  const session = await requireSession()
  return (
    <>
      <PageHeader
        title="Sign-in security"
        description="Protect your sign-in with a code from an authenticator app, so a stolen password alone cannot open your account."
        tabs={<SettingsNav role={session.role} />}
      />
      <TwoStepVerificationCard
        factorCount={session.mfaFactorCount ?? 0}
        verifiedThisSession={session.aal === "aal2"}
        email={session.email}
      />
    </>
  )
}
