"use client"

import { useState, useTransition } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { Button } from "@/components/ui/button"
import * as authApi from "@/lib/api/auth"
import { authErrorMessage, type AuthMessage } from "@/lib/api/auth-errors"

function InvitationActions({
  viewer,
  invitedEmail,
  token,
}: {
  viewer: { displayName: string; email: string }
  invitedEmail: string
  token: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<AuthMessage | null>(null)

  const sameEmail =
    viewer.email.trim().toLowerCase() === invitedEmail.trim().toLowerCase()

  function handleAccept() {
    setError(null)
    startTransition(async () => {
      try {
        await authApi.acceptInvitation(token)
        // A full navigation, not a router push: the session cookie now points
        // at the invitation's organisation and every server layout has to
        // re-read it.
        window.location.assign("/inbox")
      } catch (caught) {
        setError(authErrorMessage(caught))
      }
    })
  }

  function handleSignOut() {
    startTransition(async () => {
      try {
        await authApi.signOut()
      } catch {
        // A failed sign-out must not strand the visitor here - the
        // `finally` below still sends them back to the invite so it can
        // re-evaluate their session, the same guaranteed-exit pattern
        // AppShell's own sign-out uses.
      } finally {
        // The invited address is someone else's, and most often one that
        // already has an account: open the form in sign-in mode.
        window.location.assign(`/invite/${token}?mode=sign-in`)
      }
    })
  }

  if (sameEmail) {
    return (
      <div className="flex flex-col gap-4">
        {error ? <AuthErrorAlert message={error} /> : null}
        <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
          You are signed in as {viewer.email}, the address this invitation was
          sent to.
        </p>
        <Button
          type="button"
          size="lg"
          className="h-11 w-full"
          onClick={handleAccept}
          disabled={pending}
        >
          {pending ? "Accepting…" : "Accept invitation"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
        {`You are signed in as ${viewer.email}, but this invitation is for ${invitedEmail}.`}
      </p>
      <Button
        type="button"
        size="lg"
        className="h-11 w-full"
        onClick={handleSignOut}
        disabled={pending}
      >
        {pending ? "Signing out…" : "Sign out and continue"}
      </Button>
    </div>
  )
}

export { InvitationActions }
