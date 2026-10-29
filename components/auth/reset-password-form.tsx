"use client"

import Link from "next/link"
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { PasswordField } from "@/components/auth/password-field"
import { PasswordRequirements } from "@/components/auth/password-requirements"
import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button, buttonVariants } from "@/components/ui/button"
import * as authApi from "@/lib/api/auth"
import {
  authErrorMessage,
  fieldErrorsFrom,
  type AuthMessage,
} from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"
import { hardNavigate } from "@/lib/client/hard-navigate"
import { RESET_TOKEN_HASH_LENGTH } from "@/lib/domain/auth-limits"
import { cn } from "@/lib/utils"

const FIELD_ORDER = ["password"] as const

// A dead token can never succeed no matter how many times the user
// resubmits, so these codes tear down the form in favour of a route out
// instead of leaving a doomed form on screen. That includes an unknown
// outcome: the server spent the link before it lost track of the password.
// Every other error (rate limiting, transient server trouble, ...) leaves
// the token's validity an open question, so the form stays.
const DEAD_TOKEN_CODES = new Set([
  "invalid_email_link",
  "password_reset_failed",
  "password_reset_outcome_unknown",
])

// After a dropped connection the earlier request may have reached the
// server and saved the password, spending the link. A dead link on the
// next attempt is then no reason to start over.
const MAY_ALREADY_BE_SAVED =
  "If you pressed Update password before, your new password may already be saved. Try signing in with it, or request another link."

// Same test as authErrorMessage: a write that got no answer comes back as
// `network_error`, a bare fetch failure as a TypeError.
function isNetworkFailure(error: unknown) {
  return (
    (error instanceof ApiClientError && error.code === "network_error") ||
    error instanceof TypeError
  )
}

// Same name-based focus lookup as sign-in-form.tsx / forgot-password-form.tsx.
function focusField(name: string) {
  document.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
}

// A `tokenHash` that fails the server's own length constraint (too short or
// too long) can never succeed on submit either - the server's zod schema
// rejects it with a generic `invalid_request` that isn't in DEAD_TOKEN_CODES,
// so the doomed form would otherwise stay on screen with no highlighted
// field and no recovery route out. Treating it as missing instead routes
// through the existing missing-token recovery branch. Uses the bounds the
// domain schema itself is built from, without loading zod to render.
function isUsableToken(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= RESET_TOKEN_HASH_LENGTH.min &&
    value.length <= RESET_TOKEN_HASH_LENGTH.max
  )
}

// zod is ~20 KB gz the page would otherwise download before it can render
// (same as sign-in-form.tsx). It loads on the first focus inside the form
// and a submit awaits it.
const loadAuthSchemas = () => import("@/lib/domain/auth")

// The one way on from a link that can't be used, whether it never arrived
// whole or the server refused it.
function RequestAnotherLink() {
  return (
    <Link
      href="/forgot-password"
      className={cn(
        buttonVariants({ size: "lg", block: true }),
        WRAPPING_BLOCK_BUTTON
      )}
    >
      Request another link
    </Link>
  )
}

function ResetPasswordForm({ tokenHash }: { tokenHash?: string }) {
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [deadToken, setDeadToken] = useState(false)
  const [pending, startTransition] = useTransition()
  const alertRef = useRef<HTMLDivElement>(null)
  // Set once an attempt gets no answer: see MAY_ALREADY_BE_SAVED.
  const mayHaveLanded = useRef(false)

  // role="alert" is already an assertive live region, so this is a belt and
  // braces enhancement: move keyboard/screen-reader focus to the banner
  // whenever a server error lands with no field to blame it on (including
  // the dead-token banner-only state below). Same idiom as sign-in-form.tsx.
  useEffect(() => {
    if (message && Object.keys(fieldErrors).length === 0) {
      alertRef.current?.focus()
    }
  }, [message, fieldErrors])

  const validating = useRef(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || validating.current || !isUsableToken(tokenHash)) return
    const token = tokenHash
    // A banner from an earlier attempt must not sit above this one.
    setMessage(null)
    validating.current = true
    void loadAuthSchemas()
      .then((schemas) => submitWith(schemas, token))
      .finally(() => {
        validating.current = false
      })
  }

  function submitWith(
    { passwordSchema }: Awaited<ReturnType<typeof loadAuthSchemas>>,
    tokenHash: string
  ) {
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
    setFieldErrors({})
    startTransition(async () => {
      try {
        const result = await authApi.completePasswordReset({
          tokenHash,
          password,
        })
        hardNavigate(result.mfaRequired ? "/sign-in/verify" : "/inbox")
        // Deliberately never resolve: the page is navigating away, and
        // letting the transition "finish" here would flip the submit
        // button back to enabled during that window - reopening the
        // double-submit gap this flow exists to close (see sign-in-form.tsx).
        await new Promise<void>(() => {})
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          DEAD_TOKEN_CODES.has(error.code)
        ) {
          const dead = authErrorMessage(error, "reset-password")
          // An unknown outcome already says to try the new password.
          setMessage(
            mayHaveLanded.current &&
              error.code !== "password_reset_outcome_unknown"
              ? { ...dead, description: MAY_ALREADY_BE_SAVED }
              : dead
          )
          setDeadToken(true)
          return
        }
        if (isNetworkFailure(error)) mayHaveLanded.current = true
        const errors = fieldErrorsFrom(error)
        setFieldErrors(errors)
        const target = FIELD_ORDER.find((key) => errors[key])
        if (target) {
          // The field error says it all; a "Check the highlighted fields."
          // banner on top would only be announced a second time.
          setMessage(null)
          focusField(target)
        } else {
          setMessage(authErrorMessage(error, "reset-password"))
        }
      }
    })
  }

  if (!isUsableToken(tokenHash)) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 rounded-lg bg-surface-alt p-4">
          <p className="text-body font-semibold text-ink">
            This link is missing or incomplete
          </p>
          <p className="text-ui text-ink-muted">
            Open the newest reset email and use its link, or request a new one
            to continue.
          </p>
        </div>
        <RequestAnotherLink />
      </div>
    )
  }

  if (deadToken && message) {
    return (
      <div className="flex flex-col gap-5">
        {/* The alert's own inline link would repeat the button below. */}
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <AuthErrorAlert message={{ ...message, action: undefined }} />
        </div>
        <RequestAnotherLink />
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      onFocusCapture={() => void loadAuthSchemas()}
      noValidate
      className="flex flex-col gap-5"
    >
      {message ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <AuthErrorAlert message={message} />
        </div>
      ) : null}

      {/* A username field beside the new password marks this as an
          account's password change, so a password manager offers to update
          an existing entry rather than save a nameless one. It is empty:
          the reset link doesn't tell this page the address, and the page
          must not look it up (that would confirm the account exists). It is
          `hidden` (no tab stop, nothing for a screen reader), and never
          sent: the submit handler sends the token and password from state,
          not FormData. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        defaultValue=""
        hidden
      />

      <PasswordField
        label="New password"
        name="password"
        value={password}
        onValueChange={(next) => {
          setPassword(next)
          // Cleared together: dropping only the field error would leave a
          // banner the focus effect above then jumps to mid-typing.
          if (fieldErrors.password) {
            setFieldErrors({})
            setMessage(null)
          }
        }}
        autoComplete="new-password"
        error={fieldErrors.password}
        describedBy={<PasswordRequirements value={password} />}
      />

      <Button
        type="submit"
        size="lg"
        block
        pending={pending}
        pendingLabel="Updating…"
      >
        Update password
      </Button>
    </form>
  )
}

export { ResetPasswordForm }
