"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { PasswordField } from "@/components/auth/password-field"
import { PasswordRequirements } from "@/components/auth/password-requirements"
import { Button } from "@/components/ui/button"
import * as authApi from "@/lib/api/auth"
import {
  authErrorMessage,
  fieldErrorsFrom,
  type AuthMessage,
} from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"
import { passwordSchema, resetPasswordSchema } from "@/lib/domain/auth"

const FIELD_ORDER = ["password", "confirmPassword"] as const

// A dead token can never succeed no matter how many times the user
// resubmits, so these two codes tear down the form in favour of a route
// out instead of leaving a doomed form on screen. Every other error
// (rate limiting, transient server trouble, ...) leaves the token's
// validity an open question, so the form stays.
const DEAD_TOKEN_CODES = new Set(["invalid_email_link", "password_reset_failed"])

// Same name-based focus lookup as sign-in-form.tsx / forgot-password-form.tsx.
function focusField(name: string) {
  document.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
}

// A `tokenHash` that fails the server's own length constraint (too short or
// too long) can never succeed on submit either - the server's zod schema
// rejects it with a generic `invalid_request` that isn't in DEAD_TOKEN_CODES,
// so the doomed form would otherwise stay on screen with no highlighted
// field and no recovery route out. Treating it as missing instead routes
// through the existing missing-token recovery branch. Reuses the domain
// schema's own constraint rather than hardcoding the 20/512 bounds.
function isUsableToken(value: string | undefined): value is string {
  return resetPasswordSchema.shape.tokenHash.safeParse(value).success
}

function ResetPasswordForm({ tokenHash }: { tokenHash?: string }) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [deadToken, setDeadToken] = useState(false)
  const [pending, startTransition] = useTransition()
  const alertRef = useRef<HTMLDivElement>(null)

  // role="alert" is already an assertive live region, so this is a belt and
  // braces enhancement: move keyboard/screen-reader focus to the banner
  // whenever a server error lands with no field to blame it on (including
  // the dead-token banner-only state below). Same idiom as sign-in-form.tsx.
  useEffect(() => {
    if (message && Object.keys(fieldErrors).length === 0) {
      alertRef.current?.focus()
    }
  }, [message, fieldErrors])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !isUsableToken(tokenHash)) return

    const parsedPassword = passwordSchema.safeParse(password)
    if (!parsedPassword.success) {
      // No invented fallback copy - zod always supplies a message for every
      // issue it raises, so `message` is only ever absent in theory. Mirrors
      // zodFieldErrors in sign-in-form.tsx, which applies the same rule.
      const message = parsedPassword.error.issues[0]?.message
      setFieldErrors(message ? { password: message } : {})
      focusField("password")
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
        await authApi.completePasswordReset({ tokenHash, password })
        window.location.assign("/home")
        // Deliberately never resolve: the page is navigating away, and
        // letting the transition "finish" here would flip the submit
        // button back to enabled during that window - reopening the
        // double-submit gap this flow exists to close (see sign-in-form.tsx).
        await new Promise<void>(() => {})
      } catch (error) {
        if (error instanceof ApiClientError && DEAD_TOKEN_CODES.has(error.code)) {
          setMessage(authErrorMessage(error))
          setDeadToken(true)
          return
        }
        const errors = fieldErrorsFrom(error)
        setFieldErrors(errors)
        setMessage(authErrorMessage(error))
        const target = FIELD_ORDER.find((key) => errors[key])
        if (target) focusField(target)
      }
    })
  }

  if (!isUsableToken(tokenHash)) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-muted-foreground">
          This password reset link is missing or incomplete. Request a new
          one to continue.
        </p>
        <Link href="/forgot-password" className="underline underline-offset-4">
          Request another link
        </Link>
      </div>
    )
  }

  if (deadToken && message) {
    return (
      <div ref={alertRef} tabIndex={-1}>
        <AuthErrorAlert message={message} />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {message ? (
        <div ref={alertRef} tabIndex={-1}>
          <AuthErrorAlert message={message} />
        </div>
      ) : null}

      <PasswordField
        label="New password"
        name="password"
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
        error={fieldErrors.password}
        describedBy={<PasswordRequirements value={password} />}
      />
      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        value={confirmPassword}
        onValueChange={setConfirmPassword}
        autoComplete="new-password"
        error={fieldErrors.confirmPassword}
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  )
}

export { ResetPasswordForm }
