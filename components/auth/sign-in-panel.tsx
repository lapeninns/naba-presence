"use client"

import { useState } from "react"

import { AuthCard } from "@/components/auth/auth-card"
import { SignInForm, type SignInMode } from "@/components/auth/sign-in-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { AuthMessage } from "@/lib/api/auth-errors"

const COPY = {
  "sign-in": {
    eyebrow: "Welcome back",
    title: "Sign in to your clients’ reviews",
    description: "Every client's Google Business Profile, from one inbox.",
  },
  "create-account": {
    eyebrow: "New agency",
    title: "Create your NabaPresence account",
    description:
      "Name your agency, then add your first client and connect its Google account.",
  },
} satisfies Record<
  SignInMode,
  { eyebrow: string; title: string; description: string }
>

function SignInPanel({
  initialMode = "sign-in",
  inviteToken,
  nextPath,
  statusMessage,
  registrationAllowed = true,
}: {
  initialMode?: SignInMode
  inviteToken?: string
  nextPath?: string | null
  statusMessage?: AuthMessage
  registrationAllowed?: boolean
}) {
  const [mode, setMode] = useState<SignInMode>(
    registrationAllowed ? initialMode : "sign-in"
  )
  const copy = COPY[mode]

  return (
    <AuthCard
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      footer={
        <p>
          {registrationAllowed
            ? "Access is by invitation or a new agency account."
            : "NabaPresence is available by invitation during the pilot."}
        </p>
      }
    >
      {/* Signing in with an invitation token accepts it, so say so, but only
          when no confirmation-link status is already explaining the page. */}
      {inviteToken && !statusMessage ? (
        <Alert variant="info">
          <AlertTitle>Sign in to accept your invitation</AlertTitle>
          <AlertDescription>
            Use the email address the invitation was sent to. You’ll join the
            agency straight after.
          </AlertDescription>
        </Alert>
      ) : null}
      <SignInForm
        mode={mode}
        onModeChange={setMode}
        inviteToken={inviteToken}
        nextPath={nextPath}
        statusMessage={statusMessage}
        registrationAllowed={registrationAllowed}
      />
    </AuthCard>
  )
}

export { SignInPanel }
