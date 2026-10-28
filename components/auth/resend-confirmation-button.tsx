"use client"

import { useRef, useState, useTransition } from "react"

import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button } from "@/components/ui/button"
import { resendConfirmation } from "@/lib/api/auth"
import { authErrorMessage, type AuthSurface } from "@/lib/api/auth-errors"
import { cn } from "@/lib/utils"

/** Enough to know a request could only be refused; the server decides. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+$/

/**
 * "Resend confirmation email" as the reference's text button: accent ink,
 * underlined, 44px tall on touch. A text action, not a filled button, because
 * it is the secondary route on a surface whose one filled button is the
 * form's submit. `variant="button"` draws it as the full-width outlined
 * secondary button for the check-your-email panel, where it is the main
 * thing to do; its label wraps rather than spilling past a 320px card.
 * `className` adds to the button itself.
 *
 * The control stays on screen after a send (as "Send another link"), so
 * focus never falls to the page and a corrected address can be sent to. The
 * result is written into a region that is always mounted, so it is read
 * out; it is cleared first, so the same answer twice is still announced.
 * The success line is conditional on purpose: the server answers every
 * address the same way and sends nothing to one that is confirmed or
 * unknown, so "sent" would be untrue there.
 */
function ResendConfirmationButton({
  email,
  inviteToken,
  variant = "link",
  surface = "sign-in",
  onInvalidEmail,
  className,
}: {
  email: string
  inviteToken?: string
  variant?: "link" | "button"
  /** Titles an outage for where the button sits. */
  surface?: AuthSurface
  /**
   * The address is empty or plainly not one. Given, the form shows the
   * error on its own email field; otherwise the button says so itself.
   * Either way no request is sent.
   */
  onInvalidEmail?: (empty: boolean) => void
  className?: string
}) {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Set from press to answer, so a second press in that window (or a press
  // on the link variant, which has no native disabled) sends nothing.
  const busy = useRef(false)
  const address = email.trim()
  const label =
    sentTo !== null && sentTo === address
      ? "Send another link"
      : "Resend confirmation email"

  function send() {
    if (busy.current) return
    setNote(null)
    setFailure(null)
    if (!LOOKS_LIKE_EMAIL.test(address)) {
      if (onInvalidEmail) onInvalidEmail(address === "")
      else setFailure("Enter your email address above first.")
      return
    }
    busy.current = true
    startTransition(async () => {
      try {
        // The invitation flow sends its token along so the resent link
        // still points back at the invitation; ordinary sign-in has none to
        // send.
        await (inviteToken
          ? resendConfirmation(address, inviteToken)
          : resendConfirmation(address))
        setSentTo(address)
        setNote(
          `A new confirmation link is on its way to ${address} if it still needs confirming.`
        )
      } catch (error) {
        const message = authErrorMessage(error, surface)
        setFailure(
          message.description
            ? `${message.title} ${message.description}`
            : message.title
        )
      } finally {
        busy.current = false
      }
    })
  }

  return (
    <span
      className={cn(
        "flex flex-col items-start gap-1.5",
        variant === "button" && "w-full"
      )}
    >
      {variant === "button" ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          block
          pending={pending}
          pendingLabel="Sending…"
          className={cn(WRAPPING_BLOCK_BUTTON, className)}
          onClick={send}
        >
          {label}
        </Button>
      ) : (
        <button
          type="button"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          className={cn(
            "inline-flex min-h-(--np-touch) items-center rounded-sm text-left text-ui font-semibold text-accent-ink underline decoration-1 underline-offset-3 focus-halo hover:decoration-2 focus-visible:outline-none aria-disabled:cursor-default aria-disabled:text-ink-muted aria-disabled:no-underline desk:min-h-6",
            className
          )}
          onClick={send}
        >
          {pending ? "Sending…" : label}
        </button>
      )}
      <span
        aria-live="polite"
        className="text-caption text-pretty [overflow-wrap:anywhere] text-ink-muted empty:hidden"
      >
        {note}
      </span>
      {failure ? (
        <span className="text-caption text-danger-ink" role="alert">
          {failure}
        </span>
      ) : null}
    </span>
  )
}

export { ResendConfirmationButton }
