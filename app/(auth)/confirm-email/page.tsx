import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { ConfirmEmailForm } from "@/components/auth/confirm-email-form"

export const metadata = { title: "Confirm your email · NabaPresence" }

/**
 * The interstitial behind the emailed confirmation link (W6-05). Opening the
 * link signs nobody in: only this button's same-origin POST to
 * `/auth/confirm` consumes the one-time token. A plain form, so it works
 * before (or without) JavaScript (components/auth/confirm-email-form.tsx).
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; inviteToken?: string }>
}) {
  const params = await searchParams
  const invited = Boolean(params.inviteToken)
  // A link that lost its token can confirm nothing, so the heading says
  // what happened instead of asking for an action the page cannot offer.
  if (!params.token_hash) {
    return (
      <AuthCard
        aside={invited ? "invite" : "product"}
        eyebrow="Email confirmation"
        title="This confirmation link is incomplete"
        description="Part of the link is missing, so it can’t confirm your email."
        footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
      >
        {/* An invitee's new link has to come from the invitation, which
            carries the token; the sign-in resend has none to send. */}
        <p className="text-body text-pretty text-ink-muted">
          {invited
            ? "Open the link from your email again. If that doesn’t work, open the invitation email and follow its link."
            : "Open the link from your email again. If that doesn’t work, go to sign in and choose “Didn’t receive a confirmation email?” to get a new one."}
        </p>
      </AuthCard>
    )
  }
  return (
    <AuthCard
      aside={invited ? "invite" : "product"}
      eyebrow="Email confirmation"
      title={invited ? "Accept your invitation" : "Confirm your email"}
      description={
        invited
          ? "Confirm your email address to join the team and sign in."
          : "Confirm your email address to finish setting up your account and sign in."
      }
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ConfirmEmailForm
        tokenHash={params.token_hash}
        inviteToken={params.inviteToken}
        label={
          invited ? "Confirm and accept invitation" : "Confirm and sign in"
        }
      />
    </AuthCard>
  )
}
