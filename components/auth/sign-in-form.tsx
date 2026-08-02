"use client"

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { PasswordField } from "@/components/auth/password-field"
import { PasswordRequirements } from "@/components/auth/password-requirements"
import { ResendConfirmationButton } from "@/components/auth/resend-confirmation-button"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import * as authApi from "@/lib/api/auth"
import {
  authErrorMessage,
  fieldErrorsFrom,
  type AuthMessage,
} from "@/lib/api/auth-errors"
import { loginSchema, registerSchema } from "@/lib/domain/auth"

type Mode = "sign-in" | "create-account"

const SIGN_IN_FIELD_ORDER = ["email", "password"] as const
const CREATE_FIELD_ORDER = [
  "displayName",
  "email",
  "password",
  "confirmPassword",
] as const

// Fields are rendered by `name` (not a predictable DOM id - Field's id comes
// from an internal useId the parent never sees), so a name-based query is
// the reliable way to move focus to the first invalid input from outside
// PasswordField/Field, which don't expose a ref for this.
function focusField(name: string) {
  document.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
}

function zodFieldErrors(
  error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } },
  order: readonly string[]
): Record<string, string> {
  const flat = error.flatten().fieldErrors
  const errors: Record<string, string> = {}
  for (const key of order) {
    const message = flat[key]?.[0]
    if (message) errors[key] = message
  }
  return errors
}

function SignInForm({
  initialMode,
  inviteToken,
  invitedEmail,
  nextPath,
  statusMessage,
}: {
  initialMode?: Mode
  inviteToken?: string
  invitedEmail?: string
  nextPath?: string | null
  statusMessage?: AuthMessage
}) {
  const [mode, setMode] = useState<Mode>(initialMode ?? "sign-in")
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState(invitedEmail ?? "")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(
    statusMessage ?? null
  )
  const [stage, setStage] = useState<"form" | "confirm-sent">("form")
  const [pending, startTransition] = useTransition()
  const alertRef = useRef<HTMLDivElement>(null)

  // role="alert" is already an assertive live region, so this is a belt and
  // braces enhancement: move keyboard/screen-reader focus to the banner
  // whenever a server error lands with no field to blame it on. The alert
  // only mounts once `message` is set, so this has to happen post-commit.
  useEffect(() => {
    if (message && Object.keys(fieldErrors).length === 0) {
      alertRef.current?.focus()
    }
  }, [message, fieldErrors])

  function switchMode(next: Mode) {
    setMode(next)
    setFieldErrors({})
    setMessage(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    if (mode === "sign-in") {
      const parsed = loginSchema.safeParse({ email, password, inviteToken })
      if (!parsed.success) {
        const errors = zodFieldErrors(parsed.error, SIGN_IN_FIELD_ORDER)
        setFieldErrors(errors)
        const target = SIGN_IN_FIELD_ORDER.find((key) => errors[key])
        if (target) focusField(target)
        return
      }
      setFieldErrors({})
      startTransition(async () => {
        try {
          await authApi.signIn(parsed.data)
          window.location.assign(nextPath ?? "/home")
          // Deliberately never resolve: the page is navigating away, and
          // letting the transition "finish" here would flip the submit
          // button back to enabled during that window - reopening the
          // double-submit gap this flow exists to close.
          await new Promise<void>(() => {})
        } catch (error) {
          const errors = fieldErrorsFrom(error)
          setFieldErrors(errors)
          setMessage(authErrorMessage(error))
          const target = SIGN_IN_FIELD_ORDER.find((key) => errors[key])
          if (target) focusField(target)
        }
      })
      return
    }

    const parsed = registerSchema.safeParse({
      displayName,
      email,
      password,
      inviteToken,
    })
    if (!parsed.success) {
      const errors = zodFieldErrors(parsed.error, CREATE_FIELD_ORDER)
      if (password !== confirmPassword) {
        errors.confirmPassword = "Both passwords must match."
      }
      setFieldErrors(errors)
      const target = CREATE_FIELD_ORDER.find((key) => errors[key])
      if (target) focusField(target)
      return
    }
    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: "Both passwords must match." })
      focusField("confirmPassword")
      return
    }
    setFieldErrors({})
    startTransition(async () => {
      try {
        const result = await authApi.register(parsed.data)
        if (result.authenticated) {
          window.location.assign(nextPath ?? "/home")
          await new Promise<void>(() => {})
        } else {
          setStage("confirm-sent")
        }
      } catch (error) {
        const errors = fieldErrorsFrom(error)
        setFieldErrors(errors)
        setMessage(authErrorMessage(error))
        const target = CREATE_FIELD_ORDER.find((key) => errors[key])
        if (target) focusField(target)
      }
    })
  }

  if (stage === "confirm-sent") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">Check your email</h2>
        <p className="text-body text-muted-foreground">
          We sent a confirmation link to {email}. Open it, then sign in.
        </p>
        <ResendConfirmationButton email={email} />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setStage("form")
            setMode("sign-in")
          }}
        >
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div role="group" aria-label="Account action" className="flex gap-2">
        <Button
          type="button"
          variant={mode === "sign-in" ? "default" : "outline"}
          aria-pressed={mode === "sign-in"}
          aria-label="Switch to sign in"
          onClick={() => switchMode("sign-in")}
        >
          Sign in
        </Button>
        <Button
          type="button"
          variant={mode === "create-account" ? "default" : "outline"}
          aria-pressed={mode === "create-account"}
          aria-label="Switch to create account"
          onClick={() => switchMode("create-account")}
        >
          Create account
        </Button>
      </div>

      {message ? (
        <div ref={alertRef} tabIndex={-1}>
          <AuthErrorAlert message={message} email={email} />
        </div>
      ) : null}

      {mode === "create-account" ? (
        <Field error={fieldErrors.displayName}>
          <FieldLabel>Your name</FieldLabel>
          <Input
            name="displayName"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
          <FieldError />
        </Field>
      ) : null}

      <Field error={fieldErrors.email}>
        <FieldLabel>Email address</FieldLabel>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          readOnly={Boolean(invitedEmail)}
        />
        <FieldError />
      </Field>

      {mode === "sign-in" ? (
        <PasswordField
          label="Password"
          name="password"
          value={password}
          onValueChange={setPassword}
          autoComplete="current-password"
          error={fieldErrors.password}
        />
      ) : (
        <>
          <PasswordField
            label="Password"
            name="password"
            value={password}
            onValueChange={setPassword}
            autoComplete="new-password"
            error={fieldErrors.password}
            describedBy={<PasswordRequirements value={password} />}
          />
          <PasswordField
            label="Confirm password"
            name="confirmPassword"
            value={confirmPassword}
            onValueChange={setConfirmPassword}
            autoComplete="new-password"
            error={fieldErrors.confirmPassword}
          />
        </>
      )}

      <Button type="submit" disabled={pending}>
        {mode === "sign-in"
          ? pending
            ? "Signing in…"
            : "Sign in"
          : pending
            ? "Creating account…"
            : "Create account"}
      </Button>

      {mode === "sign-in" ? (
        // Always visible, never conditioned on the sign-in error (D3): a
        // resend affordance gated on `email_not_verified` would itself
        // confirm whether the address is registered. Showing it
        // unconditionally keeps the resend path (spec §8) without adding an
        // enumeration channel.
        <div className="flex flex-col items-start gap-1 border-t pt-4">
          <p className="text-caption text-muted-foreground">
            Didn&apos;t receive a confirmation email?
          </p>
          <ResendConfirmationButton email={email} />
        </div>
      ) : null}
    </form>
  )
}

export { SignInForm }
