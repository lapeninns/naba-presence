import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Confirm your email · NabaPresence" }

/**
 * The interstitial behind the emailed confirmation link (W6-05). Opening the
 * link signs nobody in: only this button's same-origin POST to
 * `/auth/confirm` consumes the one-time token. A plain form, so it works
 * before (or without) JavaScript.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; inviteToken?: string }>
}) {
  const params = await searchParams
  const invited = Boolean(params.inviteToken)
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
      {params.token_hash ? (
        <form method="post" action="/auth/confirm">
          <input type="hidden" name="token_hash" value={params.token_hash} />
          <input type="hidden" name="type" value="email" />
          {params.inviteToken ? (
            <input
              type="hidden"
              name="inviteToken"
              value={params.inviteToken}
            />
          ) : null}
          <Button
            type="submit"
            size="lg"
            block
            className={WRAPPING_BLOCK_BUTTON}
          >
            {invited ? "Confirm and accept invitation" : "Confirm and sign in"}
          </Button>
        </form>
      ) : (
        <p className="text-body text-pretty text-ink-muted">
          This confirmation link is incomplete. Open the link from your email
          again, or sign in to request a new one.
        </p>
      )}
    </AuthCard>
  )
}
