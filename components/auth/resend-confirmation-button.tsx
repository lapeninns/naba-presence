"use client"

import { useState, useTransition } from "react"

import { resendConfirmation } from "@/lib/api/auth"
import { authErrorMessage } from "@/lib/api/auth-errors"
import { cn } from "@/lib/utils"

/**
 * "Resend confirmation email" as the reference's text button: accent ink,
 * underlined, 44px tall on touch. A text action, not a filled button, because
 * it is the secondary route on a surface whose one filled button is the
 * form's submit. `variant="button"` draws it as a bordered secondary button
 * for the check-your-email panel, where it is the main thing to do.
 */
function ResendConfirmationButton({
  email,
  inviteToken,
  variant = "link",
}: {
  email: string
  inviteToken?: string
  variant?: "link" | "button"
}) {
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle")
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (state === "sent") {
    return (
      <span className="text-ui text-ink" role="status">
        Confirmation email sent.
      </span>
    )
  }

  return (
    <span className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        className={cn(
          "focus-halo focus-visible:outline-none disabled:cursor-default",
          variant === "link"
            ? "inline-flex min-h-6 items-center rounded-sm text-ui font-semibold text-accent-ink underline decoration-1 underline-offset-3 hover:decoration-2 disabled:text-ink-muted disabled:no-underline pointer-coarse:min-h-11"
            : "inline-flex h-(--np-control-h) items-center rounded-md border border-line-strong bg-surface px-3 text-ui font-medium text-ink transition-colors hover:bg-fill disabled:opacity-60"
        )}
        onClick={() =>
          startTransition(async () => {
            try {
              // The invitation flow sends its token along so the resent link
              // still points back at the invitation; ordinary sign-in has
              // none to send.
              await (inviteToken
                ? resendConfirmation(email, inviteToken)
                : resendConfirmation(email))
              setState("sent")
            } catch (error) {
              setFailure(authErrorMessage(error).title)
              setState("failed")
            }
          })
        }
      >
        {pending ? "Sending…" : "Resend confirmation email"}
      </button>
      {state === "failed" && failure ? (
        <span className="text-caption text-danger-ink" role="alert">
          {failure}
        </span>
      ) : null}
    </span>
  )
}

export { ResendConfirmationButton }
