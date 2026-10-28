"use client"

import { RotateCw } from "lucide-react"
import * as React from "react"

import {
  BoundaryAlert,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"
import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"

/**
 * A sign-in, invitation or password screen failed to render. Without this
 * boundary the visitor fell through to the root error page, which offers the
 * dashboard they cannot reach yet. Here they get the same auth card, a retry,
 * and the way back to sign in. Only the digest is shown: the message may
 * carry details the visitor should not see.
 *
 * AuthCard is the auth layout's own frame; the alert and button are the
 * light ones from components/app-shell/boundary.tsx, not the primitives.
 */
export default function AuthError({
  error,
  reset,
  retry,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  /** Re-fetches and re-renders the segment (Next 16.3+). */
  retry?: () => void
  /** The same, under its pre-16.3 name. */
  unstable_retry?: () => void
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <AuthCard
      eyebrow="Something went wrong"
      title="This page didn’t load"
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <BoundaryAlert title="We couldn’t show this page.">
        Nothing about your account changed. Try again in a moment.
        {error.digest ? (
          <span className="mt-1 block text-caption text-ink-muted">
            Reference{" "}
            <code className="rounded-sm bg-surface px-1 font-mono">
              {error.digest}
            </code>
          </span>
        ) : null}
      </BoundaryAlert>
      <button
        type="button"
        className={boundaryButtonClass("primary", "lg", "w-full")}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(() => {
            // `reset` alone only re-renders the payload that failed, so
            // the error would come straight back.
            ;(retry ?? unstable_retry ?? reset)()
          })
        }
      >
        <RotateCw strokeWidth={1.75} aria-hidden />
        {pending ? "Trying again…" : "Try again"}
      </button>
    </AuthCard>
  )
}
