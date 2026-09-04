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
import { queryKeys } from "@/lib/queries/keys"

// Shared across the three dead-end branches below (not-found, already
// accepted, expired) so the copy/href can't drift out of sync between them.
function GoToSignInLink() {
  return (
    <Link href="/sign-in" className="underline underline-offset-4">
      Go to sign in
    </Link>
  )
}

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
    queryKey: queryKeys.invitation(token),
    queryFn: () => authApi.lookupInvitation(token),
    retry: false,
  })

  if (query.isPending) {
    return (
      <AuthCard eyebrow="Invitation" title="Checking your invitation">
        <div aria-busy="true" className="flex flex-col gap-4">
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
          <GoToSignInLink />
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
        <GoToSignInLink />
      </AuthCard>
    )
  }

  if (data.expired) {
    return (
      <AuthCard title={`Join ${data.organisationName}`}>
        <AuthErrorAlert message={confirmStatusMessage("invitation_expired")} />
        <GoToSignInLink />
      </AuthCard>
    )
  }

  if (viewer === null) {
    return (
      <AuthCard
        eyebrow="Invitation"
        title={`Join ${data.organisationName}`}
        description="Set a password and you will be able to work on the clients this agency has given you."
      >
        <SignInForm
          initialMode="create-account"
          inviteToken={token}
          invitedEmail={data.email}
        />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      eyebrow="Invitation"
      title={`Join ${data.organisationName}`}
      description="Accepting adds this agency to the account you are already signed in with."
    >
      <InvitationActions
        viewer={viewer}
        invitedEmail={data.email}
        token={token}
      />
    </AuthCard>
  )
}

export { InvitationView }
