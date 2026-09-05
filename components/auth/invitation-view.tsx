"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, Mail, UserRound } from "lucide-react"

import { AuthCard } from "@/components/auth/auth-card"
import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { AuthLink } from "@/components/auth/auth-link"
import { InvitationActions } from "@/components/auth/invitation-actions"
import { SignInForm } from "@/components/auth/sign-in-form"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Skeleton } from "@/components/ui/skeleton"
import * as authApi from "@/lib/api/auth"
import { authErrorMessage, confirmStatusMessage } from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"
import { queryKeys } from "@/lib/queries/keys"

// Shared across the three dead-end branches below (not-found, already
// accepted, expired) so the copy/href can't drift out of sync between them.
function GoToSignInLink() {
  return <AuthLink href="/sign-in">Go to sign in</AuthLink>
}

/**
 * Who is inviting whom: the organisation and the address the invitation
 * was sent to, plus the account the visitor is currently signed in with
 * when there is one. A grouped list because these are facts to read, not
 * fields to fill. Only what the lookup actually returns is shown — the
 * response carries no inviter name, so none is invented.
 *
 * The list sits on the white card, so it takes the hairline edge that a
 * white surface on another white surface needs to be seen.
 */
function InvitationDetails({
  organisationName,
  email,
  viewerEmail,
}: {
  organisationName: string
  email: string
  viewerEmail?: string
}) {
  return (
    <GroupedList header="Invitation details" className="[&>ul]:hairline">
      <GroupedListItem
        icon={<Building2 />}
        label={organisationName}
        description="Organisation"
      />
      <GroupedListItem icon={<Mail />} label={email} description="Sent to" />
      {viewerEmail ? (
        <GroupedListItem
          icon={<UserRound />}
          label={viewerEmail}
          description="Signed in as"
        />
      ) : null}
    </GroupedList>
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
        {/* The skeleton takes the shape of what arrives: the details list,
            then the form's two fields and its button. */}
        <div aria-busy="true" className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="mx-(--np-card-pad) h-4 w-28" />
            <Skeleton className="h-22 w-full rounded-(--np-radius-card)" />
          </div>
          <Skeleton className="h-(--np-field-h) w-full rounded-(--np-radius-field)" />
          <Skeleton className="h-(--np-field-h) w-full rounded-(--np-radius-field)" />
          <Skeleton className="h-9 w-full rounded-(--np-radius-pill)" />
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
          <Button
            type="button"
            size="lg"
            pill
            className="w-full"
            onClick={() => query.refetch()}
          >
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
        <InvitationDetails
          organisationName={data.organisationName}
          email={data.email}
        />
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
      <InvitationDetails
        organisationName={data.organisationName}
        email={data.email}
        viewerEmail={viewer.email}
      />
      <InvitationActions
        viewer={viewer}
        invitedEmail={data.email}
        token={token}
      />
    </AuthCard>
  )
}

export { InvitationView }
