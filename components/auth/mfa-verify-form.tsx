"use client"

import { useEffect, useState, useTransition, type FormEvent } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ApiClientError } from "@/lib/api/client"
import { authErrorMessage, type AuthMessage } from "@/lib/api/auth-errors"
import * as mfaApi from "@/lib/api/mfa"
import { hardNavigate } from "@/lib/client/hard-navigate"
import type { MfaFactor } from "@/lib/contracts/auth"
import { totpCodeSchema } from "@/lib/contracts/auth"

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
 * form says so and sends them back to sign in.
 */
function MfaVerifyForm({ nextPath }: { nextPath?: string | null }) {
  const [factors, setFactors] = useState<MfaFactor[] | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [code, setCode] = useState("")
  const [codeError, setCodeError] = useState<string | undefined>()
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [pending, startTransition] = useTransition()

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
        setMessage(authErrorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
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
          setCodeError(
            remaining === null
              ? "That code did not match. Try the code your app shows now."
              : `That code did not match. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left.`
          )
          setCode("")
          return
        }
        setMessage(authErrorMessage(error))
      }
    })
  }

  function startOver() {
    startTransition(async () => {
      await mfaApi.cancelMfa().catch(() => {})
      hardNavigate("/sign-in")
      await new Promise<void>(() => {})
    })
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-4">
        <AuthErrorAlert
          message={{
            title: "Your sign-in has expired.",
            description:
              "For your security the code step lasts five minutes. Sign in again to continue.",
          }}
        />
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => hardNavigate("/sign-in")}
        >
          Sign in again
        </Button>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      {message ? <AuthErrorAlert message={message} /> : null}
      {factors && factors.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-ui font-semibold text-ink">
            Which app are you using?
          </legend>
          <RadioGroup<string>
            aria-label="Authenticator app"
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
        </fieldset>
      ) : null}
      <Field error={codeError}>
        <FieldLabel>6-digit code</FieldLabel>
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <FieldError>{codeError}</FieldError>
      </Field>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || factors === null}
      >
        {pending ? "Checking…" : "Verify and sign in"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={startOver}
      >
        Use a different account
      </Button>
    </form>
  )
}

export { MfaVerifyForm }
