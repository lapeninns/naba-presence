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
import { completePasswordReset } from "@/lib/naba-presence-api"

export function ResetPasswordView({ tokenHash }: { tokenHash?: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tokenHash) return
    setPending(true)
    setError(undefined)
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    const confirmation = String(form.get("confirmation") ?? "")
    if (password !== confirmation) {
      setError("The passwords do not match.")
      setPending(false)
      return
    }
    try {
      await completePasswordReset(tokenHash, password)
      window.location.assign("/reviews")
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The password could not be updated."
      )
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
            Choose a new password
          </CardTitle>
          <CardDescription>
            Use 12+ characters with a letter, number, and symbol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!tokenHash ? (
            <Alert variant="destructive">
              <AlertTitle>Invalid reset link</AlertTitle>
              <AlertDescription>
                Request a new password-reset email and try again.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to reset password</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {tokenHash ? (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </div>
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
              <Button className="w-full" disabled={pending} type="submit">
                {pending ? "Updating…" : "Update password"}
              </Button>
            </form>
          ) : (
            <Link
              href="/forgot-password"
              className={buttonVariants({ className: "w-full" })}
            >
              Request another link
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
