"use client"

import { useState } from "react"

import { AuthCard } from "@/components/auth/auth-card"
import { SignInForm, type SignInMode } from "@/components/auth/sign-in-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { AuthMessage } from "@/lib/api/auth-errors"

const COPY = {
  "sign-in": {
    eyebrow: "Welcome back",
    title: "Sign in to NabaPresence",
    description: "Your Google reviews and Business Profiles, from one inbox.",
  },
  "create-account": {
    eyebrow: "New account",
    title: "Create your NabaPresence account",
    description:
      "Set it up for your own business or for an agency, then connect Google.",
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
  workspaceChoice = false,
}: {
  initialMode?: SignInMode
  inviteToken?: string
  nextPath?: string | null
  statusMessage?: AuthMessage
  registrationAllowed?: boolean
  /** REGISTRATION_WORKSPACE_CHOICE_ENABLED: offer business or agency. */
  workspaceChoice?: boolean
}) {
  const [mode, setMode] = useState<SignInMode>(
    registrationAllowed ? initialMode : "sign-in"
  )
  // An invited person joins the inviting organisation, so the business or
  // agency choice the create-account copy mentions is not theirs to make.
  const copy =
    inviteToken && mode === "create-account"
      ? {
          ...COPY[mode],
          description: "Create an account with the invited email address.",
        }
      : mode === "create-account" && !workspaceChoice
        ? {
            ...COPY[mode],
            description: "Set it up for your business, then connect Google.",
          }
        : COPY[mode]

  return (
    <AuthCard
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      footer={
        <p>
          {registrationAllowed
            ? "Access is by invitation or a new account."
            : "NabaPresence is available by invitation during the pilot."}
        </p>
      }
    >
      {/* Signing in with an invitation token accepts it, so say so, but only
          when no confirmation-link status is already explaining the page,
          and only in sign-in mode: creating an account has its own line. */}
      {inviteToken && !statusMessage && mode === "sign-in" ? (
        <Alert variant="info">
          <AlertTitle>Sign in to accept your invitation</AlertTitle>
          <AlertDescription>
            Use the email address the invitation was sent to. You’ll join
            straight after.
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
        workspaceChoice={workspaceChoice}
      />
    </AuthCard>
  )
}

export { SignInPanel }
