import {
  clientResponseSchema,
  clientSetupResponseSchema,
  clientsResponseSchema,
  clientSummarySchema,
  type ClientAssignLocationsInput,
  type ClientCreateInput,
  type ClientUpdateInput,
} from "@/lib/contracts/clients"
import { z } from "zod"

import { apiFetch } from "./client"

const mutationResponseSchema = z.object({ client: clientSummarySchema })

export function fetchClients(signal?: AbortSignal) {
  return apiFetch("/api/clients", { schema: clientsResponseSchema, signal })
}

export function fetchClient(clientId: string, signal?: AbortSignal) {
  return apiFetch(`/api/clients/${clientId}`, {
    schema: clientResponseSchema,
    signal,
  })
}

export function fetchClientSetup(clientId: string, signal?: AbortSignal) {
  return apiFetch(`/api/clients/${clientId}/setup`, {
    schema: clientSetupResponseSchema,
    signal,
  })
}

export function createClient(input: ClientCreateInput) {
  return apiFetch("/api/clients", {
    method: "POST",
    body: input,
    schema: mutationResponseSchema,
  })
}

export function updateClient(clientId: string, input: ClientUpdateInput) {
  return apiFetch(`/api/clients/${clientId}`, {
    method: "PATCH",
    body: input,
    schema: mutationResponseSchema,
  })
}

export function assignLocationsToClient(
  clientId: string,
  input: ClientAssignLocationsInput
) {
  return apiFetch(`/api/clients/${clientId}/locations`, {
    method: "POST",
    body: input,
    schema: z.object({ assigned: z.array(z.string()) }),
  })
}

export function unassignLocationsFromClient(
  clientId: string,
  locationIds: string[]
) {
  return apiFetch(`/api/clients/${clientId}/locations`, {
    method: "DELETE",
    body: { locationIds },
    schema: z.object({ unassigned: z.array(z.string()) }),
  })
}
