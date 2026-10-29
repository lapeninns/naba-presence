"use client"

import { useEffect, useRef, useState } from "react"

import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button } from "@/components/ui/button"

/**
 * The confirmation interstitial's one button. Still a plain same-origin
 * form POST to `/auth/confirm` with the same fields, so it works before (or
 * without) JavaScript; hydrated, it shows that the confirmation is under way
 * and lets only the first press through. The first submit is never
 * prevented: the browser posts and follows the 303 as before. A second press
 * would spend the already-used token and land on "expired" although the
 * address was just confirmed.
 */
function ConfirmEmailForm({
  tokenHash,
  inviteToken,
  label,
}: {
  tokenHash: string
  inviteToken?: string
  label: string
}) {
  const [pending, setPending] = useState(false)
  const sent = useRef(false)

  // A page restored from the back-forward cache must not stay on
  // "Confirming…" with its one press already used.
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return
      sent.current = false
      setPending(false)
    }
    window.addEventListener("pageshow", restore)
    return () => window.removeEventListener("pageshow", restore)
  }, [])

  return (
    <form
      method="post"
      action="/auth/confirm"
      onSubmit={(event) => {
        if (sent.current) {
          event.preventDefault()
          return
        }
        sent.current = true
        setPending(true)
      }}
    >
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value="email" />
      {inviteToken ? (
        <input type="hidden" name="inviteToken" value={inviteToken} />
      ) : null}
      <Button
        type="submit"
        size="lg"
        block
        pending={pending}
        pendingLabel="Confirming…"
        className={WRAPPING_BLOCK_BUTTON}
      >
        {label}
      </Button>
    </form>
  )
}

export { ConfirmEmailForm }
