"use client"

import Link from "next/link"

import { ResendConfirmationButton } from "@/components/auth/resend-confirmation-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { AuthMessage } from "@/lib/api/auth-errors"

function AuthErrorAlert({
  message,
  email,
}: {
  message: AuthMessage
  email?: string
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{message.title}</AlertTitle>
      {message.description || message.action ? (
        <AlertDescription className="flex flex-col items-start gap-2">
          {message.description ? <span>{message.description}</span> : null}
          {message.action === "resend-confirmation" && email ? (
            <ResendConfirmationButton email={email} />
          ) : null}
          {message.action === "request-reset-link" ? (
            <Link href="/forgot-password" className="underline underline-offset-4">
              Request another link
            </Link>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

export { AuthErrorAlert }
