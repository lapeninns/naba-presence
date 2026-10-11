"use client"

import { useState, useTransition, type FormEvent } from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiClientError } from "@/lib/api/client"
import { authErrorMessage, type AuthMessage } from "@/lib/api/auth-errors"
import * as mfaApi from "@/lib/api/mfa"
import { hardNavigate } from "@/lib/client/hard-navigate"
import { totpCodeSchema, type MfaEnrollResponse } from "@/lib/contracts/auth"

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
}: {
  factorCount: number
  verifiedThisSession: boolean
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const [password, setPassword] = useState("")
  const [currentCode, setCurrentCode] = useState("")
  const [newCode, setNewCode] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [pending, startTransition] = useTransition()
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
    <Card flush>
      <CardHeader divided>
        <CardTitle as="h2">Two-step verification</CardTitle>
        <CardDescription>{statusLine(factorCount)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-(--np-card-pad)">
        {factorCount > 0 ? (
          <p className="text-body text-ink-muted">
            {verifiedThisSession
              ? "You entered a code when you signed in to this session."
              : "This session was opened without a code. Sign in again to use one."}
          </p>
        ) : null}
        {message ? <AuthErrorAlert message={message} /> : null}

        {stage.kind === "idle" && canAdd ? (
          <div>
            <Button type="button" onClick={() => setStage({ kind: "confirm" })}>
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
                <Input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={currentCode}
                  onChange={(event) => setCurrentCode(event.target.value)}
                />
                <FieldError />
              </Field>
            ) : null}
            <div className="flex gap-2">
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
              Scan this code with your authenticator app (for example Google
              Authenticator, 1Password or Authy), then enter the 6-digit code it
              shows.
            </p>
            {/* A data: URI from our own API (lib/server/password-auth.ts). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stage.enrollment.qrCode}
              alt="QR code for your authenticator app"
              width={180}
              height={180}
              className="rounded-md border border-line bg-white p-2"
            />
            <p className="text-caption text-ink-muted">
              Can’t scan it? Enter this key instead:{" "}
              <code className="font-mono [overflow-wrap:anywhere] text-ink">
                {stage.enrollment.secret}
              </code>
            </p>
            <Field error={errors.newCode}>
              <FieldLabel>6-digit code</FieldLabel>
              <FieldDescription>
                {stage.enrollment.factorNumber === 1
                  ? "From the app you just set up."
                  : "From the backup app you just set up."}
              </FieldDescription>
              <Input
                name="newCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                value={newCode}
                onChange={(event) => setNewCode(event.target.value)}
              />
              <FieldError />
            </Field>
            <div className="flex gap-2">
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
      </CardContent>
    </Card>
  )
}
