"use client"

import { ArrowRight, MessageSquareText } from "lucide-react"
import { useState } from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { beginGoogleConnect } from "@/lib/naba-presence-api"

export function SignInView({
  errorStatus,
  inviteToken,
  title = "Sign in to NabaPresence",
  description = "Connect the Google account that manages your Business Profile.",
}: {
  errorStatus?: string
  inviteToken?: string
  title?: string
  description?: string
}) {
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string>()

  async function continueWithGoogle() {
    setPending(true)
    setLocalError(undefined)
    try {
      const { authorizationUrl } = await beginGoogleConnect(
        inviteToken ? { inviteToken } : undefined
      )
      window.location.assign(authorizationUrl)
    } catch (error) {
      setPending(false)
      setLocalError(
        error instanceof Error ? error.message : "Sign-in failed."
      )
    }
  }

  const errorMessage = localError
    ? localError
    : errorStatus
      ? `Google sign-in failed (status ${errorStatus}). Try again.`
      : undefined

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <MessageSquareText className="size-5" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <CardTitle
              role="heading"
              aria-level={1}
              className="font-heading text-2xl"
            >
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to sign in</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="w-full"
            disabled={pending}
            onClick={continueWithGoogle}
          >
            {pending ? "Connecting…" : "Continue with Google"}
            <ArrowRight aria-hidden />
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
