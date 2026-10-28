"use client"

import Link from "next/link"
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react"

import { AuthCard } from "@/components/auth/auth-card"
import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { focusFirstCodeBox } from "@/components/auth/focus-code-box"
import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { OtpField } from "@/components/ui/otp-field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ApiClientError } from "@/lib/api/client"
import {
  authErrorMessage,
  retryAfterWords,
  type AuthMessage,
} from "@/lib/api/auth-errors"
import * as mfaApi from "@/lib/api/mfa"
import { hardNavigate } from "@/lib/client/hard-navigate"
import type { MfaFactor } from "@/lib/contracts/auth"
import { cn } from "@/lib/utils"

// zod is ~20 KB gz the page would otherwise download before it can render
// (same as sign-in-form.tsx). It loads on the first focus inside the form
// and a submit awaits it.
const loadAuthContract = () => import("@/lib/contracts/auth")

function attemptsRemaining(error: unknown): number | null {
  if (!(error instanceof ApiClientError)) return null
  const details = error.details
  if (typeof details !== "object" || details === null) return null
  const value = Reflect.get(details, "attemptsRemaining")
  return typeof value === "number" ? value : null
}

/**
 * The second step of signing in for a person with two-step verification:
 * the code from their authenticator app (or the backup's). The pending
 * sign-in lives in an httpOnly cookie for five minutes; when it is gone the
 * card says so and sends them back to sign in. The form renders the card
 * itself, so the heading can follow the state.
 */
function MfaVerifyForm({ nextPath }: { nextPath?: string | null }) {
  const [factors, setFactors] = useState<MfaFactor[] | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [code, setCode] = useState("")
  const [codeError, setCodeError] = useState<string | undefined>()
  const [message, setMessage] = useState<AuthMessage | null>(null)
  // Bumped by "Try again" to re-run the factors load.
  const [loadKey, setLoadKey] = useState(0)
  const [pending, startTransition] = useTransition()
  // Leaving has its own transition, so "Use a different account" is the
  // button that says it is working, not "Verify and sign in".
  const [leaving, startLeaving] = useTransition()
  const codeRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const pickerLabelId = useId()

  useEffect(() => {
    let cancelled = false
    mfaApi
      .pendingFactors()
      .then((result) => {
        if (cancelled) return
        setFactors(result.factors)
        setFactorId(result.factors[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (
          error instanceof ApiClientError &&
          error.code === "mfa_ticket_invalid"
        ) {
          setExpired(true)
          return
        }
        setMessage(authErrorMessage(error, "mfa"))
      })
    return () => {
      cancelled = true
    }
  }, [loadKey])

  function retryLoad() {
    setMessage(null)
    setLoadKey((key) => key + 1)
    // The alert and this button unmount, so focus goes back to the code.
    focusFirstCodeBox(codeRef.current)
  }

  // As on sign-in: a server error with no field to blame takes focus, so
  // keyboard and screen-reader users land on it. A wrong code sets
  // `codeError` instead and keeps focusing box 1.
  useEffect(() => {
    if (message) alertRef.current?.focus()
  }, [message])

  const validating = useRef(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || leaving || validating.current) return
    validating.current = true
    void loadAuthContract()
      .then((contract) => submitWith(contract))
      .finally(() => {
        validating.current = false
      })
  }

  function submitWith({
    totpCodeSchema,
  }: Awaited<ReturnType<typeof loadAuthContract>>) {
    const parsed = totpCodeSchema.safeParse(code)
    if (!parsed.success) {
      setCodeError("Enter the 6-digit code from your authenticator app.")
      return
    }
    setCodeError(undefined)
    setMessage(null)
    startTransition(async () => {
      try {
        await mfaApi.verifyMfaCode({
          code: parsed.data,
          factorId: factorId ?? undefined,
        })
        hardNavigate(nextPath ?? "/inbox")
        // Never resolve: the page is navigating away (see sign-in-form.tsx).
        await new Promise<void>(() => {})
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === "mfa_ticket_invalid"
        ) {
          setExpired(true)
          return
        }
        if (
          error instanceof ApiClientError &&
          error.code === "mfa_code_invalid"
        ) {
          const remaining = attemptsRemaining(error)
          // With two apps, the likeliest miss is a code from the other one.
          const checkApp =
            factors && factors.length > 1
              ? " Check that the selected app is the one showing this code."
              : ""
          setCodeError(
            remaining === null
              ? "That code did not match. Try the code your app shows now."
              : `That code did not match.${checkApp} ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left.`
          )
          setCode("")
          focusFirstCodeBox(codeRef.current)
          return
        }
        // The limit outlasts the five-minute code step, so trying again
        // here would only meet an expired sign-in: say to start over.
        if (
          error instanceof ApiClientError &&
          error.code === "auth_rate_limited"
        ) {
          setMessage({
            title: "Too many attempts.",
            description: `For your security, codes are paused. Wait ${retryAfterWords(error) ?? "a few minutes"}, then sign in again.`,
          })
          return
        }
        setMessage(authErrorMessage(error, "mfa"))
      }
    })
  }

  // The only field on the screen, so it takes focus (and on a phone, the
  // keyboard) as soon as it is there. When the sign-in expires the form
  // unmounts, so the heading that now says so takes focus instead.
  useEffect(() => {
    if (expired) titleRef.current?.focus()
    else focusFirstCodeBox(codeRef.current)
  }, [expired])

  function startOver() {
    startLeaving(async () => {
      await mfaApi.cancelMfa().catch(() => {})
      hardNavigate("/sign-in")
      await new Promise<void>(() => {})
    })
  }

  if (expired) {
    return (
      <AuthCard
        eyebrow="Two-step verification"
        title="Your sign-in has expired"
        description="For your security, the code step ends after five minutes or five wrong codes. Sign in again to continue."
        titleRef={titleRef}
      >
        {/* A link: it is navigation, works before hydration, and keeps
            where the person was going. */}
        <Link
          href={
            nextPath
              ? `/sign-in?next=${encodeURIComponent(nextPath)}`
              : "/sign-in"
          }
          className={cn(
            buttonVariants({ size: "lg", block: true }),
            WRAPPING_BLOCK_BUTTON
          )}
        >
          Sign in again
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      eyebrow="Two-step verification"
      title="Enter your code"
      description="Open your authenticator app and enter the 6-digit code it shows for NabaPresence."
      titleRef={titleRef}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={handleSubmit}
        onFocusCapture={() => void loadAuthContract()}
        noValidate
      >
        {message ? (
          <div
            ref={alertRef}
            tabIndex={-1}
            className="flex flex-col gap-3 outline-none"
          >
            <AuthErrorAlert message={message} />
            {/* Only a failed factors load leaves no factors behind; without
                them the code cannot be sent, so offer the load again. */}
            {factors === null ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                block
                onClick={retryLoad}
              >
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
        {factors && factors.length > 1 ? (
          // Named once, by the visible question: no fieldset legend on top
          // of the radio group's own name.
          <div className="flex flex-col gap-2">
            <span
              id={pickerLabelId}
              className="mb-1.5 text-ui font-semibold text-ink"
            >
              Which app are you using?
            </span>
            <RadioGroup<string>
              aria-labelledby={pickerLabelId}
              value={factorId ?? undefined}
              onValueChange={(value) => setFactorId(value)}
            >
              {factors.map((factor, index) => (
                <RadioGroupItem<string> key={factor.id} value={factor.id}>
                  {index === 0 ? "Authenticator app" : "Backup authenticator"}
                  {factor.friendlyName ? ` (${factor.friendlyName})` : ""}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </div>
        ) : null}
        <Field error={codeError}>
          <FieldLabel>6-digit code</FieldLabel>
          {/* No auto-submit: attempts are limited, so a mistyped sixth digit
              must not spend one before the person can see and fix it, and
              with two apps the right one may still need choosing. Pasted or
              typed spaces ("123 456") are dropped by the field. */}
          <OtpField
            ref={codeRef}
            name="code"
            length={6}
            value={code}
            onValueChange={setCode}
          />
          <FieldDescription>
            From your authenticator app. Codes refresh every 30 seconds.
          </FieldDescription>
          <FieldError>{codeError}</FieldError>
        </Field>
        <Button
          type="submit"
          size="lg"
          block
          className={WRAPPING_BLOCK_BUTTON}
          pending={pending}
          pendingLabel="Checking…"
          disabled={factors === null}
        >
          Verify and sign in
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          block
          className={WRAPPING_BLOCK_BUTTON}
          pending={leaving}
          pendingLabel="Signing out…"
          disabled={pending}
          onClick={startOver}
        >
          Use a different account
        </Button>
      </form>
    </AuthCard>
  )
}

export { MfaVerifyForm }
