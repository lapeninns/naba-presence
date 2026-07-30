"use client"

import { ArrowRight, MessageSquareText } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent } from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  registerWithEmailPassword,
  signInWithEmailPassword,
} from "@/lib/naba-presence-api"

export function SignInView({
  errorStatus,
  inviteToken,
  invitedEmail,
  title = "Sign in to NabaPresence",
  description = "Use your NabaPresence account. Google Business Profile is connected separately by an organisation owner.",
}: {
  errorStatus?: string
  inviteToken?: string
  invitedEmail?: string
  title?: string
  description?: string
}) {
  const [mode, setMode] = useState<"sign_in" | "register">(
    inviteToken ? "register" : "sign_in"
  )
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [email, setEmail] = useState(invitedEmail ?? "")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setLocalError(undefined)
    setMessage(undefined)
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    try {
      if (mode === "register") {
        const confirmation = String(form.get("confirmation") ?? "")
        if (password !== confirmation) {
          setLocalError("The passwords do not match.")
          return
        }
        const result = await registerWithEmailPassword({
          displayName: String(form.get("displayName") ?? ""),
          email,
          password,
          inviteToken,
        })
        if (!result.authenticated) {
          setMessage(
            "Check your email to confirm your account, then return here to sign in."
          )
          setMode("sign_in")
          return
        }
      } else {
        await signInWithEmailPassword({ email, password, inviteToken })
      }
      window.location.assign("/reviews")
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Sign-in failed."
      )
    } finally {
      setPending(false)
    }
  }

  const errorMessage = localError
    ? localError
    : errorStatus
      ? "This sign-in link is invalid or expired. Request a fresh email and try again."
      : undefined

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <MessageSquareText className="size-5" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <CardTitle
              role="heading"
              aria-level={1}
              className="font-heading text-2xl"
            >
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to sign in</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {message ? (
            <Alert>
              <AlertTitle>Confirm your email</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-2" aria-label="Account action">
            <Button
              type="button"
              variant={mode === "sign_in" ? "default" : "outline"}
              onClick={() => setMode("sign_in")}
              disabled={pending}
              aria-pressed={mode === "sign_in"}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === "register" ? "default" : "outline"}
              onClick={() => setMode("register")}
              disabled={pending}
              aria-pressed={mode === "register"}
            >
              Create account
            </Button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            {mode === "register" ? (
              <div className="space-y-2">
                <Label htmlFor="display-name">Name</Label>
                <Input
                  id="display-name"
                  name="displayName"
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                readOnly={Boolean(invitedEmail)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="password">Password</Label>
                {mode === "sign_in" && !inviteToken ? (
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </Link>
                ) : null}
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
                aria-describedby={
                  mode === "register" ? "password-requirements" : undefined
                }
                required
              />
              {mode === "register" ? (
                <p
                  id="password-requirements"
                  className="text-xs text-muted-foreground"
                >
                  Use 12+ characters with a letter, number, and symbol.
                </p>
              ) : null}
            </div>
            {mode === "register" ? (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </div>
            ) : null}
            <Button className="w-full" disabled={pending} type="submit">
              {pending
                ? mode === "register"
                  ? "Creating account…"
                  : "Signing in…"
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
              <ArrowRight aria-hidden />
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
