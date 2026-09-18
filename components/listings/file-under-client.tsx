"use client"

import * as React from "react"

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
  const items = clients.data?.items ?? []
  if (items.length === 0) return null

  return (
    <Select
      value={null}
      disabled={assignLocations.isPending}
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
  )
}

export { FileUnderClient }
