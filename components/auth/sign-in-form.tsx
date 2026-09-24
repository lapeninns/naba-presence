"use client"

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react"

import { ChevronRight, Mail } from "lucide-react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { AuthLink } from "@/components/auth/auth-link"
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
import { cn } from "@/lib/utils"

type SignInMode = "sign-in" | "create-account"

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

/**
 * The domain schemas' own messages are written for the API ("Too small:
 * expected string to have >=2 characters"); these say what to do instead.
 * Only the wording changes: which fields fail is still the schema's call.
 */
function friendlyFieldErrors(
  errors: Record<string, string>,
  values: { displayName: string; email: string; password: string }
): Record<string, string> {
  const next = { ...errors }
  if (next.displayName) {
    next.displayName =
      values.displayName.trim().length > 120
        ? "Use no more than 120 characters."
        : "Enter your name, at least 2 characters."
  }
  if (next.email) {
    next.email = values.email.trim()
      ? "Enter an email address like name@agency.co.uk."
      : "Enter your email address."
  }
  if (next.password && !values.password) next.password = "Enter your password."
  return next
}

function zodFieldErrors(
  error: {
    flatten: () => { fieldErrors: Record<string, string[] | undefined> }
  },
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
  mode: controlledMode,
  onModeChange,
  inviteToken,
  invitedEmail,
  nextPath,
  statusMessage,
}: {
  initialMode?: SignInMode
  mode?: SignInMode
  onModeChange?: (mode: SignInMode) => void
  inviteToken?: string
  invitedEmail?: string
  nextPath?: string | null
  statusMessage?: AuthMessage
}) {
  const [uncontrolledMode, setUncontrolledMode] = useState<SignInMode>(
    initialMode ?? "sign-in"
  )
  const mode = controlledMode ?? uncontrolledMode
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

  function switchMode(next: SignInMode) {
    if (controlledMode === undefined) setUncontrolledMode(next)
    setFieldErrors({})
    setMessage(null)
    onModeChange?.(next)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    if (mode === "sign-in") {
      const parsed = loginSchema.safeParse({ email, password, inviteToken })
      if (!parsed.success) {
        const errors = friendlyFieldErrors(
          zodFieldErrors(parsed.error, SIGN_IN_FIELD_ORDER),
          { displayName, email, password }
        )
        setFieldErrors(errors)
        const target = SIGN_IN_FIELD_ORDER.find((key) => errors[key])
        if (target) focusField(target)
        return
      }
      setFieldErrors({})
      startTransition(async () => {
        try {
          await authApi.signIn(parsed.data)
          window.location.assign(nextPath ?? "/inbox")
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
      const errors = friendlyFieldErrors(
        zodFieldErrors(parsed.error, CREATE_FIELD_ORDER),
        { displayName, email, password }
      )
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
          window.location.assign(nextPath ?? "/inbox")
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
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="mb-1 grid size-11 place-items-center rounded-lg bg-accent-tint text-accent-ink"
          >
            <Mail className="size-5" strokeWidth={1.75} />
          </span>
          <h2 className="text-section font-semibold text-ink">
            Check your email
          </h2>
          <p className="text-body text-ink-muted">
            We sent a confirmation link to{" "}
            <span className="font-semibold [overflow-wrap:anywhere] text-ink">
              {email}
            </span>
            . Open it, then sign in.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 rounded-lg bg-surface-alt p-4">
          <p className="text-ui text-ink">
            Not there after a few minutes? Check spam or promotions, then send a
            fresh link.
          </p>
          <ResendConfirmationButton
            email={email}
            inviteToken={inviteToken}
            variant="button"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full"
          onClick={() => {
            setStage("form")
            switchMode("sign-in")
          }}
        >
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {message ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <AuthErrorAlert message={message} email={email} />
        </div>
      ) : null}

      {/* Two pressed buttons rather than a tablist: the two modes are one
          form with two shapes, not two panels, and `aria-pressed` is what
          tests and assistive tech read. Drawn as the reference's full-width
          segmented control. */}
      <div
        role="group"
        aria-label="Account action"
        className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-fill p-[3px]"
      >
        {(
          [
            ["sign-in", "Sign in", "Switch to sign in"],
            ["create-account", "Create account", "Switch to create account"],
          ] as const
        ).map(([value, label, name]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            aria-label={name}
            onClick={() => switchMode(value)}
            className={cn(
              "inline-flex h-[30px] items-center justify-center rounded-[7px] px-3 text-ui font-medium whitespace-nowrap focus-halo transition-colors duration-(--np-duration-fast) focus-visible:outline-none pointer-coarse:h-10",
              mode === value
                ? "bg-surface text-ink shadow-np-raised"
                : "text-ink-secondary hover:bg-surface/50 hover:text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>

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
          labelAside={
            <AuthLink
              // Carry what was typed, so the reset form starts filled in.
              href={
                email.trim()
                  ? `/forgot-password?${new URLSearchParams({ email: email.trim() })}`
                  : "/forgot-password"
              }
              className="text-ui"
            >
              Forgot password?
            </AuthLink>
          }
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

      <Button
        type="submit"
        size="lg"
        className="h-11 w-full"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {mode === "sign-in"
          ? pending
            ? "Signing in…"
            : "Sign in"
          : pending
            ? "Creating account…"
            : "Create account"}
      </Button>

      {nextPath && nextPath !== "/inbox" ? (
        <p className="-mt-2 text-caption text-ink-muted">
          After signing in you’ll go back to{" "}
          <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-[12px] [overflow-wrap:anywhere] text-ink">
            {nextPath}
          </code>
          .
        </p>
      ) : null}

      {mode === "sign-in" ? (
        // Always visible, never conditioned on the sign-in error (D3): a
        // resend affordance gated on `email_not_verified` would itself
        // confirm whether the address is registered. Showing it
        // unconditionally keeps the resend path (spec §8) without adding an
        // enumeration channel.
        // Folded behind a disclosure: most people signing in never need it,
        // and it sat under the form competing with the one action they came
        // for. Still always present, so the no-enumeration rule above holds.
        <details className="group border-t border-line pt-4">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm text-caption text-ink-muted focus-halo hover:text-ink focus-visible:outline-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 transition-transform duration-(--np-duration-fast) group-open:rotate-90"
            />
            Didn&apos;t receive a confirmation email?
          </summary>
          <div className="flex flex-col items-start gap-1 pt-2">
            <ResendConfirmationButton email={email} inviteToken={inviteToken} />
          </div>
        </details>
      ) : null}
    </form>
  )
}

export { SignInForm, type SignInMode }
