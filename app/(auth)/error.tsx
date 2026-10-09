"use client"

import { RotateCw } from "lucide-react"
import * as React from "react"

import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * A sign-in, invitation or password screen failed to render. Without this
 * boundary the visitor fell through to the root error page, which offers the
 * dashboard they cannot reach yet. Here they get the same auth card, a retry,
 * and the way back to sign in. Only the digest is shown: the message may
 * carry details the visitor should not see.
 */
export default function AuthError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  unstable_retry?: () => void
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <AuthCard
      eyebrow="Something went wrong"
      title="This page didn’t load"
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <Alert variant="destructive">
        <AlertTitle>We couldn’t show this page.</AlertTitle>
        <AlertDescription>
          Nothing about your account changed. Try again in a moment.
          {error.digest ? (
            <span className="mt-1 block text-caption text-ink-muted">
              Reference{" "}
              <code className="rounded-sm bg-surface px-1 font-mono">
                {error.digest}
              </code>
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        size="lg"
        className="h-11 w-full"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(() => {
            ;(unstable_retry ?? reset)()
          })
        }
      >
        <RotateCw strokeWidth={1.75} aria-hidden />
        {pending ? "Trying again…" : "Try again"}
      </Button>
    </AuthCard>
  )
}
