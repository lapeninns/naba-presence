"use client"

import { notFound } from "next/navigation"

import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageFrame } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"
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

  if (directory.isPending) {
    return (
      <PageFrame width="wide">
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-7 w-64 max-w-full" />
              <Skeleton className="h-(--np-pill-h) w-28 rounded-(--np-radius-pill)" />
            </div>
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton
                key={index}
                className="h-24 rounded-(--np-radius-card)"
              />
            ))}
          </div>
        </div>
      </PageFrame>
    )
  }

  const entry = directory.data?.find((candidate) => candidate.id === locationId)
  if (!entry) {
    if (directory.data) notFound()
    return null
  }

  return (
    <ClientScopeProvider clientId={entry.clientId ?? null}>
      {children(entry)}
    </ClientScopeProvider>
  )
}

export { ListingGate }
