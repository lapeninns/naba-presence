"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { resendConfirmation } from "@/lib/api/auth"
import { authErrorMessage } from "@/lib/api/auth-errors"

function ResendConfirmationButton({
  email,
  inviteToken,
}: {
  email: string
  inviteToken?: string
}) {
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle")
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (state === "sent") {
    return (
      <span className="text-ui" role="status">
        Confirmation email sent.
      </span>
    )
  }

  return (
    <span className="flex flex-col items-start gap-1.5">
      {/* A plain text action, not a grey button: it is the secondary route
          on a surface whose one filled button is the form's submit. */}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="px-0"
        disabled={pending}
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
      </Button>
      {state === "failed" && failure ? (
        <span className="text-caption text-danger-ink" role="alert">
          {failure}
        </span>
      ) : null}
    </span>
  )
}

export { ResendConfirmationButton }
