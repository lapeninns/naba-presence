"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { InvitationActions } from "@/components/auth/invitation-actions"
import { SignInForm } from "@/components/auth/sign-in-form"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import * as authApi from "@/lib/api/auth"
import { authErrorMessage, confirmStatusMessage } from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"

function InvitationView({
  token,
  viewer,
}: {
  token: string
  viewer: { displayName: string; email: string } | null
}) {
  // retry: false - the shared query client defaults to retry: 1, which would
  // double the wait before every error branch below renders (and briefly
  // hide the 404-vs-500 distinction behind a silent retry).
  const query = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => authApi.lookupInvitation(token),
    retry: false,
  })

  if (query.isPending) {
    return (
      <AuthCard title="Checking your invitation">
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </AuthCard>
    )
  }

  if (query.isError) {
    // A missing invitation is a dead end with one way out (sign in on your
    // own). Every other failure (network trouble, a 500, ...) is transient,
    // so it gets a retry instead of being routed away.
    const notFound =
      query.error instanceof ApiClientError &&
      query.error.code === "invitation_not_found"
    return (
      <AuthCard title="Accept invitation">
        <AuthErrorAlert message={authErrorMessage(query.error)} />
        {notFound ? (
          <Link href="/sign-in" className="underline underline-offset-4">
            Go to sign in
          </Link>
        ) : (
          <Button type="button" onClick={() => query.refetch()}>
            Try again
          </Button>
        )}
      </AuthCard>
    )
  }

  const { data } = query

  if (data.accepted) {
    return (
      <AuthCard title={`Join ${data.organisationName}`}>
        <Alert variant="info">
          <AlertTitle>You have already accepted this invitation.</AlertTitle>
        </Alert>
        <Link href="/sign-in" className="underline underline-offset-4">
          Go to sign in
        </Link>
      </AuthCard>
    )
  }

  if (data.expired) {
    return (
      <AuthCard title={`Join ${data.organisationName}`}>
        <AuthErrorAlert message={confirmStatusMessage("invitation_expired")} />
        <Link href="/sign-in" className="underline underline-offset-4">
          Go to sign in
        </Link>
      </AuthCard>
    )
  }

  if (viewer === null) {
    return (
      <AuthCard title={`Join ${data.organisationName}`}>
        <SignInForm
          initialMode="create-account"
          inviteToken={token}
          invitedEmail={data.email}
        />
      </AuthCard>
    )
  }

  return (
    <AuthCard title={`Join ${data.organisationName}`}>
      <InvitationActions viewer={viewer} invitedEmail={data.email} token={token} />
    </AuthCard>
  )
}

export { InvitationView }
