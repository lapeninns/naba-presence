"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset } from "@/lib/naba-presence-api"

export function ForgotPasswordView() {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const form = new FormData(event.currentTarget)
    try {
      const result = await requestPasswordReset(String(form.get("email") ?? ""))
      setMessage(result.message)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The reset request could not be sent."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle
            role="heading"
            aria-level={1}
            className="font-heading text-2xl"
          >
            Reset your password
          </CardTitle>
          <CardDescription>
            We will send a password-reset link if the email belongs to an
            account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message ? (
            <Alert>
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to send reset email</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <Button className="w-full" disabled={pending} type="submit">
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
          <Link
            href="/sign-in"
            className={buttonVariants({ variant: "ghost", className: "w-full" })}
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
