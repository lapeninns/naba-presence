"use client"

import { useState, useTransition } from "react"

import { buttonVariants } from "@/components/ui/button"
import { resendConfirmation } from "@/lib/api/auth"
import { authErrorMessage } from "@/lib/api/auth-errors"
import { cn } from "@/lib/utils"

/**
 * "Resend confirmation email" as the reference's text button: accent ink,
 * underlined, 44px tall on touch. A text action, not a filled button, because
 * it is the secondary route on a surface whose one filled button is the
 * form's submit. `variant="button"` draws it as the full-width outlined
 * secondary button for the check-your-email panel, where it is the main
 * thing to do.
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
    <span
      className={cn(
        "flex flex-col items-start gap-1.5",
        variant === "button" && "w-full"
      )}
    >
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        className={
          variant === "link"
            ? "inline-flex min-h-(--np-touch) items-center rounded-sm text-ui font-semibold text-accent-ink underline decoration-1 underline-offset-3 focus-halo hover:decoration-2 focus-visible:outline-none disabled:cursor-default disabled:text-ink-muted disabled:no-underline desk:min-h-6"
            : buttonVariants({ variant: "secondary", size: "lg", block: true })
        }
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
