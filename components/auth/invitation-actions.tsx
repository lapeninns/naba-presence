"use client"

import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import * as authApi from "@/lib/api/auth"

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
        window.location.assign(`/invite/${token}`)
      }
    })
  }

  const sameEmail = viewer.email === invitedEmail

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">
        {sameEmail
          ? `You are signed in as ${viewer.email}. Sign out and continue to accept this invitation.`
          : `You are signed in as ${viewer.email}, but this invitation is for ${invitedEmail}.`}
      </p>
      <Button type="button" onClick={handleSignOut} disabled={pending}>
        {pending ? "Signing out…" : "Sign out and continue"}
      </Button>
    </div>
  )
}

export { InvitationActions }
