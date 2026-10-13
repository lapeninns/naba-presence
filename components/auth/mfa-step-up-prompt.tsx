"use client"

import { QueryClientContext } from "@tanstack/react-query"
import Link from "next/link"
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { focusFirstCodeBox } from "@/components/auth/focus-code-box"
import { PasswordField } from "@/components/auth/password-field"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { OtpField } from "@/components/ui/otp-field"
import { authErrorMessage, type AuthMessage } from "@/lib/api/auth-errors"
import {
  ApiClientError,
  MFA_STEP_UP_EVENT,
  type MfaStepUpEventDetail,
} from "@/lib/api/client"
import * as mfaApi from "@/lib/api/mfa"
import { MFA_ENROLLMENT_REQUIRED, totpCodeSchema } from "@/lib/contracts/auth"
import type { SessionResponse } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"

type Mode = "closed" | "step_up" | "enroll" | "verified"

/**
 * Two-step verification before a sensitive action (P02-S9).
 *
 * Mounted once in the app shell. When an owner or admin's action answers
 * 403 `mfa_step_up_required`, lib/api/client.ts raises MFA_STEP_UP_EVENT and
 * this asks for the password and a current code (POST
 * /api/auth/mfa/step-up), which renews the session's proof for 15 minutes.
 * The action itself is not replayed: the editor kept what was typed, and the
 * person sends it again. An owner or admin with no authenticator app
 * (`mfa_enrollment_required`) is sent to the enrollment screen instead.
 *
 * On a phone the Dialog is a bottom sheet whose footer rides the keyboard;
 * once a password or code is typed, a stray swipe or scrim tap asks before
 * throwing it away.
 */
function MfaStepUpPrompt() {
  const [mode, setMode] = useState<Mode>("closed")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [backup, setBackup] = useState(false)
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [codeError, setCodeError] = useState<string | undefined>()
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [pending, startTransition] = useTransition()
  // The signed-in address, for the password manager (see the hidden field
  // below). Read from the session already in the query cache when the
  // prompt opens; the shell only mounts this once the session is ready.
  const queryClient = useContext(QueryClientContext)
  const [username, setUsername] = useState("")
  const codeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onStepUp(event: Event) {
      const detail = (event as CustomEvent<MfaStepUpEventDetail>).detail
      setUsername(
        queryClient?.getQueryData<SessionResponse>(queryKeys.session)?.session
          ?.email ?? ""
      )
      setMessage(null)
      setPasswordError(undefined)
      setCodeError(undefined)
      setCode("")
      setMode(detail?.code === MFA_ENROLLMENT_REQUIRED ? "enroll" : "step_up")
    }
    window.addEventListener(MFA_STEP_UP_EVENT, onStepUp)
    return () => window.removeEventListener(MFA_STEP_UP_EVENT, onStepUp)
  }, [queryClient])

  function close() {
    setMode("closed")
    setPassword("")
    setCode("")
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const parsed = totpCodeSchema.safeParse(code)
    setPasswordError(password ? undefined : "Enter your password.")
    setCodeError(
      parsed.success
        ? undefined
        : "Enter the 6-digit code from your authenticator app."
    )
    if (!password || !parsed.success) return
    setMessage(null)
    startTransition(async () => {
      try {
        await mfaApi.stepUpMfa({
          password,
          code: parsed.data,
          factor: backup ? "backup" : "primary",
        })
        setPassword("")
        setCode("")
        setMode("verified")
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.code === MFA_ENROLLMENT_REQUIRED) {
            setMode("enroll")
            return
          }
          if (error.code === "mfa_code_invalid") {
            setCodeError(
              "That code did not match. Try the code your app shows now."
            )
            setCode("")
            focusFirstCodeBox(codeRef.current)
            return
          }
          if (error.code === "mfa_factor_unknown") {
            setCodeError("You have no backup authenticator app.")
            return
          }
          if (error.code === "invalid_credentials") {
            setPasswordError("That password is incorrect.")
            return
          }
        }
        setMessage(authErrorMessage(error))
      }
    })
  }

  return (
    <Dialog
      open={mode !== "closed"}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      dirty={mode === "step_up" && (password !== "" || code !== "")}
      onDiscard={close}
    >
      <DialogContent>
        {mode === "enroll" ? (
          <>
            <DialogHeader>
              <DialogTitle>Set up two-step verification</DialogTitle>
              <DialogDescription>
                Owners and administrators need an authenticator app before they
                change the team, Google connections or settings, or publish and
                approve. It takes a minute.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Not now
              </Button>
              <Link
                href="/settings/security"
                className={buttonVariants()}
                onClick={close}
              >
                Set up now
              </Link>
            </DialogFooter>
          </>
        ) : mode === "verified" ? (
          <>
            <DialogHeader>
              <DialogTitle>You’re verified</DialogTitle>
              <DialogDescription>
                Try that again. For the next 15 minutes you won’t be asked for a
                code.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="contents">
            <DialogHeader>
              <DialogTitle>Confirm it’s you</DialogTitle>
              <DialogDescription>
                This change needs your password and a code from your
                authenticator app.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              {message ? <AuthErrorAlert message={message} /> : null}
              {/* Which account the password belongs to, for password
                  managers: they pair a current-password field with the
                  username beside it. Never shown, never submitted. */}
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={username}
                readOnly
                hidden
              />
              <PasswordField
                label="Password"
                name="password"
                value={password}
                onValueChange={setPassword}
                autoComplete="current-password"
                error={passwordError}
                autoFocus
              />
              <Field error={codeError}>
                <FieldLabel>6-digit code</FieldLabel>
                {/* No auto-submit: the password and the backup choice are
                    part of the same answer. Spaces are dropped. */}
                <OtpField
                  ref={codeRef}
                  name="code"
                  length={6}
                  value={code}
                  onValueChange={setCode}
                />
                <FieldError>{codeError}</FieldError>
              </Field>
              <Checkbox
                checked={backup}
                onCheckedChange={(checked) => setBackup(Boolean(checked))}
                label="The code is from my backup app"
              />
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Checking…" : "Verify"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { MfaStepUpPrompt }
