"use client"

import { Copy, Smartphone } from "lucide-react"
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { focusFirstCodeBox } from "@/components/auth/focus-code-box"
import { PasswordField } from "@/components/auth/password-field"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { OtpField } from "@/components/ui/otp-field"
import { ApiClientError } from "@/lib/api/client"
import { authErrorMessage, type AuthMessage } from "@/lib/api/auth-errors"
import * as mfaApi from "@/lib/api/mfa"
import { hardNavigate } from "@/lib/client/hard-navigate"
import { totpCodeSchema, type MfaEnrollResponse } from "@/lib/contracts/auth"
import { cn } from "@/lib/utils"

const MAX_FACTORS = 2

type Stage =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "scan"; enrollment: MfaEnrollResponse }

function statusLine(factorCount: number): string {
  if (factorCount <= 0) return "Off. Signing in needs only your password."
  if (factorCount === 1) {
    return "On, with one authenticator app. Add a backup in case you lose that device."
  }
  return "On, with an authenticator app and a backup."
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to read and retype. */
export function groupSecret(secret: string): string {
  return (
    secret
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  )
}

type CopyState = "idle" | "copied" | "failed"

/**
 * Only an `otpauth://` URI becomes a link. The value comes from our own
 * enroll API, but it is rendered as an `href`, so anything else (a
 * `javascript:` URL from a compromised or buggy response) is dropped and the
 * setup key and QR code still work. The URI is never logged, stored or put
 * in this page's own URL: tapping it hands it straight to the OS.
 */
function authenticatorHref(uri: string): string | null {
  return /^otpauth:\/\//i.test(uri) ? uri : null
}

/**
 * The three ways into an authenticator app, phone first. On a phone the app
 * is on the same device, so a QR code on its own screen can't be scanned:
 * the otpauth link opens the app directly, and the setup key copies in one
 * tap. At the desk (fine pointer, 48rem+) the QR code leads, because the
 * app is on the phone in the person's other hand. Layout only: the order
 * flips in CSS, and every route is present at every width.
 */
function AuthenticatorSetup({ enrollment }: { enrollment: MfaEnrollResponse }) {
  const [copy, setCopy] = useState<CopyState>("idle")
  const appHref = authenticatorHref(enrollment.uri)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    []
  )

  async function copyKey() {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    try {
      // The raw secret, never the grouped display string: apps reject the
      // spaces some of them would paste in.
      await navigator.clipboard.writeText(enrollment.secret)
      setCopy("copied")
    } catch {
      setCopy("failed")
    }
    resetTimer.current = setTimeout(() => setCopy("idle"), 4000)
  }

  return (
    <div className="flex flex-col gap-4">
      {appHref ? (
        <a
          href={appHref}
          className={cn(
            // Tinted, not solid: "Turn on" below stays the one primary.
            buttonVariants({ variant: "tinted", size: "lg" }),
            "w-full desk:order-2 desk:w-fit"
          )}
        >
          <Smartphone aria-hidden />
          Open in authenticator app
        </a>
      ) : null}

      <div className="flex flex-col gap-1.5 desk:order-3">
        <p className="text-ui font-semibold text-ink">Setup key</p>
        <p className="text-caption text-ink-muted">
          If the app doesn’t open, copy this key and add it in the app by hand.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <code className="min-w-0 rounded-md border border-line bg-surface-alt px-2.5 py-1.5 font-mono text-body tracking-wide [overflow-wrap:anywhere] text-ink">
            {groupSecret(enrollment.secret)}
          </code>
          <Button type="button" variant="secondary" onClick={copyKey}>
            <Copy aria-hidden />
            Copy key
          </Button>
          <span
            role="status"
            className={cn(
              "text-caption",
              copy === "failed" ? "text-danger-ink" : "text-ink-muted"
            )}
          >
            {copy === "copied"
              ? "Copied"
              : copy === "failed"
                ? "Couldn’t copy. Select the key and copy it."
                : ""}
          </span>
        </div>
      </div>

      <figure className="flex flex-col gap-2 desk:order-1">
        {/* A data: URI from our own API (lib/server/password-auth.ts). On
            white in both themes: scanners need the light quiet zone. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={enrollment.qrCode}
          alt="QR code for your authenticator app"
          width={180}
          height={180}
          className="size-40 rounded-md border border-line bg-white p-2 desk:size-45"
        />
        <figcaption className="text-caption text-ink-muted">
          Or scan this with the app on another device.
        </figcaption>
      </figure>
    </div>
  )
}

/**
 * Two-step verification for the signed-in person (P02-S8): set up an
 * authenticator app, then optionally a backup (at most two). Enrolling asks
 * for the password again, and adding the backup also asks for a code from
 * the current app; a verified code raises this session to the stronger
 * level, so the page reloads with a fresh session afterwards.
 */
export function TwoStepVerificationCard({
  factorCount,
  verifiedThisSession,
  email,
}: {
  factorCount: number
  verifiedThisSession: boolean
  /** The signed-in address, only as a password-manager hint (see below). */
  email?: string
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const [password, setPassword] = useState("")
  const [currentCode, setCurrentCode] = useState("")
  const [newCode, setNewCode] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [pending, startTransition] = useTransition()
  const titleId = useId()
  const newCodeRef = useRef<HTMLDivElement>(null)
  const needsCurrentCode = factorCount > 0
  const canAdd = factorCount < MAX_FACTORS

  function reset() {
    setStage({ kind: "idle" })
    setPassword("")
    setCurrentCode("")
    setNewCode("")
    setErrors({})
    setMessage(null)
  }

  function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const nextErrors: Record<string, string> = {}
    if (!password) nextErrors.password = "Enter your password."
    const code = needsCurrentCode ? totpCodeSchema.safeParse(currentCode) : null
    if (code && !code.success) {
      nextErrors.code = "Enter the 6-digit code from your current app."
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setMessage(null)
    startTransition(async () => {
      try {
        const enrollment = await mfaApi.startMfaEnrollment({
          password,
          code: code?.success ? code.data : undefined,
        })
        setPassword("")
        setCurrentCode("")
        setStage({ kind: "scan", enrollment })
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === "mfa_code_invalid"
        ) {
          setErrors({
            code: "That code did not match. Try the code your app shows now.",
          })
          return
        }
        if (
          error instanceof ApiClientError &&
          error.code === "invalid_credentials"
        ) {
          setErrors({ password: "That password is incorrect." })
          return
        }
        setMessage(authErrorMessage(error))
      }
    })
  }

  function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const code = totpCodeSchema.safeParse(newCode)
    if (!code.success) {
      setErrors({ newCode: "Enter the 6-digit code your app shows." })
      return
    }
    setErrors({})
    setMessage(null)
    startTransition(async () => {
      try {
        await mfaApi.verifyMfaCode({ code: code.data })
        // The session was replaced by a stronger one: reload from scratch.
        hardNavigate("/settings/security")
        await new Promise<void>(() => {})
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === "mfa_code_invalid"
        ) {
          setErrors({
            newCode:
              "That code did not match. Try the code your app shows now.",
          })
          setNewCode("")
          focusFirstCodeBox(newCodeRef.current)
          return
        }
        if (
          error instanceof ApiClientError &&
          error.code === "mfa_ticket_invalid"
        ) {
          setStage({ kind: "idle" })
          setMessage({
            title: "Setup timed out.",
            description: "Start again; the new app was not added.",
          })
          return
        }
        setMessage(authErrorMessage(error))
      }
    })
  }

  return (
    <SettingsSection
      id={titleId}
      title="Two-step verification"
      description={statusLine(factorCount)}
      variant="group"
    >
      <div className="flex flex-col gap-4">
        {factorCount > 0 ? (
          <p className="text-ui text-ink-secondary">
            {verifiedThisSession
              ? "You entered a code when you signed in to this session."
              : "This session was opened without a code. Sign in again to use one."}
          </p>
        ) : null}
        {message ? <AuthErrorAlert message={message} /> : null}

        {stage.kind === "idle" && canAdd ? (
          <div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => setStage({ kind: "confirm" })}
            >
              {factorCount === 0
                ? "Set up an authenticator app"
                : "Add a backup app"}
            </Button>
          </div>
        ) : null}

        {stage.kind === "confirm" ? (
          <form
            className="flex max-w-md flex-col gap-4"
            onSubmit={startEnrollment}
            noValidate
          >
            {/* Which account this password belongs to, for password
                managers (they pair a current-password field with the
                username beside it). `hidden` with a value is the pattern
                Chromium documents for an implied username; it is no tab
                stop and nothing reads it: the submit handler sends state,
                never FormData. */}
            {email ? (
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={email}
                readOnly
                hidden
              />
            ) : null}
            <PasswordField
              label="Your password"
              name="password"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
              error={errors.password}
              autoFocus
            />
            {needsCurrentCode ? (
              <Field error={errors.code}>
                <FieldLabel>Code from your current app</FieldLabel>
                <OtpField
                  name="code"
                  length={6}
                  value={currentCode}
                  onValueChange={setCurrentCode}
                />
                <FieldError />
              </Field>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={pending}>
                {pending ? "Checking…" : "Continue"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={reset}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {stage.kind === "scan" ? (
          <form
            className="flex max-w-md flex-col gap-4"
            onSubmit={confirmEnrollment}
            noValidate
          >
            <p className="text-body text-ink">
              Add NabaPresence to your authenticator app (for example Google
              Authenticator, 1Password or Authy), then enter the 6-digit code it
              shows.
            </p>
            <AuthenticatorSetup enrollment={stage.enrollment} />
            <Field error={errors.newCode}>
              <FieldLabel>6-digit code</FieldLabel>
              <FieldDescription>
                {stage.enrollment.factorNumber === 1
                  ? "From the app you just set up."
                  : "From the backup app you just set up."}
              </FieldDescription>
              {/* Not autofocused: on a phone the keyboard would push the
                  app link and the setup key off screen just as they are
                  needed. No auto-submit, so a mistyped digit can be fixed. */}
              <OtpField
                ref={newCodeRef}
                name="newCode"
                length={6}
                value={newCode}
                onValueChange={setNewCode}
              />
              <FieldError />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={pending}>
                {pending ? "Checking…" : "Turn on"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  void mfaApi.cancelMfa().catch(() => {})
                  reset()
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </SettingsSection>
  )
}
