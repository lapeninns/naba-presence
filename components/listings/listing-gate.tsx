"use client"

import Link from "next/link"
import { notFound } from "next/navigation"
import * as React from "react"

import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageFrame } from "@/components/app-shell/page-frame"
import { ListingSkeleton } from "@/components/listings/listing-skeleton"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"

/**
 * Holds a listing page behind the directory's first resolution.
 *
 * The directory is the source of truth for "does this listing exist and may
 * this session see it". Rendering an overview or an editor before it has
 * answered would paint chrome for an id that may 404 a moment later, so
 * every listing page waits here, and `notFound()` is called once the list
 * has resolved and the id is not in it. The client scope is declared at the
 * same time so the shell's health chip reports the right client.
 */
function ListingGate({
  locationId,
  role,
  children,
}: {
  locationId: string
  role: string | null
  children: (entry: DirectoryEntry) => React.ReactNode
}) {
  const directory = useLocationDirectory(role)
  const entry = directory.data?.find((candidate) => candidate.id === locationId)
  const retryRequested = React.useRef(false)
  React.useEffect(() => {
    if (entry && retryRequested.current) {
      retryRequested.current = false
      document.getElementById("main")?.focus()
    }
  }, [entry])
  const errorPanel = directory.isError ? (
    <DirectoryError
      error={directory.error}
      initial={!entry}
      pending={directory.isFetching}
      locationId={locationId}
      retry={() => {
        retryRequested.current = !entry
        void directory.refetch()
      }}
    />
  ) : null

  // The same announced shape as the route's loading state, so the page
  // doesn't swap one skeleton for another, and an area page never flashes
  // the overview's cards.
  if (directory.isPending || (!entry && directory.isFetching)) {
    return <ListingSkeleton />
  }

  if (!entry) {
    if (errorPanel) return <PageFrame width="wide">{errorPanel}</PageFrame>
    if (directory.isSuccess) notFound()
    return null
  }

  return (
    <ClientScopeProvider clientId={entry.clientId ?? null}>
      {errorPanel ? (
        <div className="px-5 pt-6 md:px-(--np-page-pad-x)">{errorPanel}</div>
      ) : null}
      {children(entry)}
    </ClientScopeProvider>
  )
}

function DirectoryError({
  error,
  initial,
  pending,
  locationId,
  retry,
}: {
  error: unknown
  initial: boolean
  pending: boolean
  locationId: string
  retry: () => void
}) {
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (initial) titleRef.current?.focus()
  }, [initial])
  const status = error instanceof ApiClientError ? error.status : null
  const Heading = initial ? "h1" : "h2"
  return (
    <Alert variant="destructive">
      <AlertTitle>
        <Heading ref={titleRef} tabIndex={-1} className="outline-none">
          {initial
            ? "We couldn’t load this listing"
            : "We couldn’t refresh your listings"}
        </Heading>
      </AlertTitle>
      <AlertDescription>
        {status === 404
          ? "The listing directory is unavailable. Try again to check this listing."
          : describeActionError(error)}
        {status === 403 ? " Ask an owner or admin to check your access." : null}
        {!initial ? " The last loaded listing is still shown." : null}
      </AlertDescription>
      <AlertActions>
        {status === 401 ? (
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/listings/${locationId}`)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Sign in again
          </Link>
        ) : status !== 403 ? (
          <Button
            variant="outline"
            size="sm"
            pending={pending}
            pendingLabel="Trying again…"
            onClick={retry}
          >
            Try again
          </Button>
        ) : null}
        <Link
          href="/listings"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Back to listings
        </Link>
      </AlertActions>
    </Alert>
  )
}

export { ListingGate }
