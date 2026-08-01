"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { resendConfirmation } from "@/lib/api/auth"
import { authErrorMessage } from "@/lib/api/auth-errors"

function ResendConfirmationButton({ email }: { email: string }) {
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
    <span className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              await resendConfirmation(email)
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
