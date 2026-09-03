"use client"

import { useState } from "react"

import { AuthCard } from "@/components/auth/auth-card"
import { SignInForm, type SignInMode } from "@/components/auth/sign-in-form"
import type { AuthMessage } from "@/lib/api/auth-errors"

const COPY = {
  "sign-in": {
    eyebrow: "Welcome back",
    title: "Sign in to run your reviews",
    description: "Trusted replies for Google Business Profile, from one inbox.",
  },
  "create-account": {
    eyebrow: "New organisation",
    title: "Create your NabaPresence account",
    description:
      "Set up your organisation, then connect Google Business Profile once from Settings.",
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
}: {
  initialMode?: SignInMode
  inviteToken?: string
  nextPath?: string | null
  statusMessage?: AuthMessage
}) {
  const [mode, setMode] = useState<SignInMode>(initialMode)
  const copy = COPY[mode]

  return (
    <AuthCard
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      footer={
        <a className="underline underline-offset-4" href="/forgot-password">
          Forgot your password?
        </a>
      }
    >
      <SignInForm
        mode={mode}
        onModeChange={setMode}
        inviteToken={inviteToken}
        nextPath={nextPath}
        statusMessage={statusMessage}
      />
    </AuthCard>
  )
}

export { SignInPanel }
