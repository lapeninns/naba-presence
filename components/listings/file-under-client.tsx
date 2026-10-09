"use client"

import Link from "next/link"
import * as React from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { ApiClientError } from "@/lib/api/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import { useClientMutations, useClients } from "@/lib/queries/use-clients"

/**
 * File an unfiled listing under a client, from the row it sits on.
 *
 * This used to take six steps through a client's settings page, and it
 * needed the operator to know the client before they could open the page
 * that asked. Here the question is asked where the listing is.
 */
function FileUnderClient({
  locationId,
  locationName,
}: {
  locationId: string
  locationName: string
}) {
  const clients = useClients()
  const { assignLocations } = useClientMutations()
  const toasts = useToastManager()
  const retryRequested = React.useRef(false)
  const createLinkRef = React.useRef<HTMLAnchorElement>(null)
  const selectRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (clients.isSuccess && retryRequested.current) {
      retryRequested.current = false
      if (createLinkRef.current) createLinkRef.current.focus()
      else selectRef.current?.focus()
    }
  }, [clients.isSuccess])
  const items = clients.data?.items ?? []
  const status =
    clients.error instanceof ApiClientError ? clients.error.status : null
  if (clients.isPending)
    return (
      <span role="status" className="text-caption text-ink-muted">
        Loading clients…
      </span>
    )
  const failure = clients.isError ? (
    <div role="alert" className="flex flex-col items-start gap-2 text-caption">
      <span>
        {describeActionError(clients.error)}
        {status === 403 ? " Ask an owner or admin to check your access." : null}
      </span>
      {status === 401 ? (
        <Link
          href={`/sign-in?next=${encodeURIComponent(`/listings/${locationId}`)}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onClick={(event) => event.stopPropagation()}
        >
          Sign in again
        </Link>
      ) : status !== 403 ? (
        <Button
          variant="outline"
          size="sm"
          pending={clients.isFetching}
          pendingLabel="Loading clients…"
          onClick={(event) => {
            event.stopPropagation()
            retryRequested.current = true
            void clients.refetch()
          }}
        >
          Retry clients
        </Button>
      ) : null}
    </div>
  ) : null
  if (items.length === 0) {
    if (failure) return failure
    return (
      <div className="flex flex-col items-start gap-2 text-caption">
        <span role="status">No clients yet.</span>
        <Link
          ref={createLinkRef}
          href={`/clients/new?listing=${encodeURIComponent(locationId)}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onClick={(event) => event.stopPropagation()}
        >
          Create client
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {failure}
      <Select
        value={null}
        disabled={assignLocations.isPending || status === 401 || status === 403}
        onValueChange={(clientId: string | null) => {
          if (!clientId) return
          const client = items.find((entry) => entry.id === clientId)
          void assignLocations
            .mutateAsync({ clientId, locationIds: [locationId] })
            .then(() =>
              toasts.add({
                title: `${locationName} filed under ${client?.name ?? "the client"}`,
                type: "success",
              })
            )
            .catch((error: unknown) =>
              toasts.add({ title: describeActionError(error), type: "error" })
            )
        }}
      >
        <SelectTrigger
          ref={selectRef}
          className="h-7 w-44 text-caption"
          aria-label={`File ${locationName} under a client`}
          onClick={(event: React.MouseEvent) => event.stopPropagation()}
        >
          <SelectValue>
            {() => (assignLocations.isPending ? "Filing…" : "File under…")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export { FileUnderClient }
