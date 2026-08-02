"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import * as authApi from "@/lib/api/auth"
import {
  authErrorMessage,
  fieldErrorsFrom,
  type AuthMessage,
} from "@/lib/api/auth-errors"
import { resetRequestSchema } from "@/lib/domain/auth"

// Fields are rendered by `name` (Field's id comes from an internal useId
// the parent never sees), so a name-based query is the reliable way to
// move focus to an invalid input - same approach as sign-in-form.tsx.
function focusField(name: string) {
  document.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const alertRef = useRef<HTMLDivElement>(null)

  // role="alert" is already an assertive live region, so this is a belt and
  // braces enhancement: move keyboard/screen-reader focus to the banner
  // whenever a server error lands with no field to blame it on. The alert
  // only mounts once `message` is set, so this has to happen post-commit.
  // Same idiom as sign-in-form.tsx.
  useEffect(() => {
    if (message && Object.keys(fieldErrors).length === 0) {
      alertRef.current?.focus()
    }
  }, [message, fieldErrors])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const parsed = resetRequestSchema.safeParse({ email })
    if (!parsed.success) {
      // No invented fallback copy - zod always supplies a message for every
      // issue it raises, so `message` is only ever absent in theory. Mirrors
      // zodFieldErrors in sign-in-form.tsx, which applies the same rule.
      const message = parsed.error.issues[0]?.message
      setFieldErrors(message ? { email: message } : {})
      focusField("email")
      return
    }
    setFieldErrors({})
    startTransition(async () => {
      try {
        await authApi.requestPasswordReset(parsed.data.email)
        setSentTo(parsed.data.email)
      } catch (error) {
        const errors = fieldErrorsFrom(error)
        setFieldErrors(errors)
        setMessage(authErrorMessage(error))
        if (errors.email) focusField("email")
      }
    })
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-body">
          If an account exists for {sentTo}, a reset link is on its way.
        </p>
        <Link href="/sign-in" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {message ? (
        <div ref={alertRef} tabIndex={-1}>
          <AuthErrorAlert message={message} email={email} />
        </div>
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
        />
        <FieldError />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  )
}

export { ForgotPasswordForm }
