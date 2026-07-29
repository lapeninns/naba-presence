"use client"

import { useEffect, useState } from "react"

import { SignInView } from "@/components/naba-presence/sign-in-view"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { lookupInvitation } from "@/lib/naba-presence-api"

type InvitationLookup = {
  organisationName: string
  email: string
  expired: boolean
}

export function InvitationView({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<InvitationLookup | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )

  useEffect(() => {
    let active = true
    void lookupInvitation(token)
      .then((result) => {
        if (!active) return
        setInvitation(result)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [token])

  if (status === "loading") {
    return (
      <main className="flex min-h-svh items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Loading invitation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </main>
    )
  }

  if (status === "error" || !invitation) {
    return (
      <main className="flex min-h-svh items-center justify-center px-4 py-10">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Invitation not found</AlertTitle>
          <AlertDescription>
            Ask an organisation owner to create a new invitation.
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (invitation.expired) {
    return (
      <main className="flex min-h-svh items-center justify-center px-4 py-10">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Invitation expired</AlertTitle>
          <AlertDescription>
            Ask {invitation.organisationName} for a fresh invitation link.
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <SignInView
      inviteToken={token}
      title={`Join ${invitation.organisationName}`}
      description={`Continue with Google to join as ${invitation.email}. The Google account email may differ from the invited address.`}
    />
  )
}
