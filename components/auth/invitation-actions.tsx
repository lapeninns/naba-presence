"use client"

import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState, useTransition } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button, buttonVariants } from "@/components/ui/button"
import * as authApi from "@/lib/api/auth"
import { authErrorMessage, type AuthMessage } from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"
import { hardNavigate } from "@/lib/client/hard-navigate"
import { queryKeys } from "@/lib/queries/keys"
import { cn } from "@/lib/utils"

// An accept that fails for one of these reasons can never succeed, so the
// view asks the lookup again and lets its matching dead end (with no
// details, D8) replace the details and the Accept button. Not
// `invitation_changed`: that invitation is still live, and its copy asks
// for a reload.
const TERMINAL_ACCEPT_ERRORS = new Set([
  "invitation_expired",
  "invitation_already_used",
  "invitation_not_found",
])

function InvitationActions({
  viewer,
  invitedEmail,
  token,
  onFinished,
}: {
  viewer: { displayName: string; email: string }
  invitedEmail: string
  token: string
  /**
   * Accepting found the invitation finished: the lookup is re-run and its
   * dead end replaces this button, so the view moves focus to its title.
   */
  onFinished?: () => void
}) {
  const queryClient = useQueryClient()
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
        hardNavigate("/inbox")
        // Deliberately never resolve: the page is navigating away, and
        // letting the transition "finish" here would flip the button back
        // to live during that window - a second press would accept again.
        await new Promise<void>(() => {})
      } catch (caught) {
        setError(authErrorMessage(caught, "invitation"))
        if (
          caught instanceof ApiClientError &&
          TERMINAL_ACCEPT_ERRORS.has(caught.code)
        ) {
          onFinished?.()
          void queryClient.invalidateQueries({
            queryKey: queryKeys.invitation(token),
          })
        }
      }
    })
  }

  function handleSignOut() {
    startTransition(async () => {
      try {
        await authApi.signOut()
      } catch {
        // A failed sign-out must not strand the visitor here - the
        // navigation below still sends them back to the invite so it can
        // re-evaluate their session, the same guaranteed-exit pattern
        // AppShell's own sign-out uses.
      }
      // The invited address is someone else's, and most often one that
      // already has an account: open the form in sign-in mode.
      hardNavigate(`/invite/${token}?mode=sign-in`)
      // Never resolve, as in handleAccept: the button stays busy while the
      // page leaves.
      await new Promise<void>(() => {})
    })
  }

  if (sameEmail) {
    // The description and the "Signed in as" row already say which account
    // this joins, so the action follows the details directly.
    return (
      <div className="flex flex-col gap-5">
        {error ? <AuthErrorAlert message={error} /> : null}
        <Button
          type="button"
          size="lg"
          block
          className={WRAPPING_BLOCK_BUTTON}
          onClick={handleAccept}
          pending={pending}
          pendingLabel="Accepting…"
        >
          Accept invitation
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
        {`You are signed in as ${viewer.email}, but this invitation is for ${invitedEmail}.`}
      </p>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          block
          className={WRAPPING_BLOCK_BUTTON}
          onClick={handleSignOut}
          pending={pending}
          pendingLabel="Signing out…"
        >
          Sign out and continue
        </Button>
        {/* Opened in the wrong browser profile, say: keep the account you
            are in. A ghost link, so the sign-out stays the one primary. */}
        <Link
          href="/inbox"
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg", block: true }),
            WRAPPING_BLOCK_BUTTON
          )}
        >
          Go to Inbox instead
        </Link>
      </div>
    </div>
  )
}

export { InvitationActions }
