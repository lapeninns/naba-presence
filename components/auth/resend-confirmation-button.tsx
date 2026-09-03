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
      <Button
        type="button"
        variant="outline"
        size="sm"
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
        <span className="text-caption text-destructive" role="alert">
          {failure}
        </span>
      ) : null}
    </span>
  )
}

export { ResendConfirmationButton }
