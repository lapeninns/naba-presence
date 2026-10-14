import type {
  ClientAssignLocationsInput,
  ClientAttachConnectionInput,
  ClientCreateInput,
  ClientUpdateInput,
} from "@/lib/contracts/clients"

import { apiFetch, type RequestOptions } from "./client"

// Schemas load on demand (see `ResponseSchema` in ./client): the sidebar
// reads the client list on every page, and the contract pulls in zod.
const contract = () => import("@/lib/contracts/clients")

// Reads take `RequestOptions`, not a bare signal, so a query passes
// `requestOptions(ctx)` and a background refetch's 401 never redirects.
export function fetchClients(options?: RequestOptions) {
  return apiFetch("/api/clients", {
    schema: () => contract().then((m) => m.clientsResponseSchema),
    ...options,
  })
}

/** Archived clients only, for the Clients page's Archived view. */
export function fetchArchivedClients(options?: RequestOptions) {
  return apiFetch("/api/clients?archived=1", {
    schema: () => contract().then((m) => m.clientsResponseSchema),
    ...options,
  })
}

export function fetchClient(clientId: string, options?: RequestOptions) {
  return apiFetch(`/api/clients/${clientId}`, {
    schema: () => contract().then((m) => m.clientResponseSchema),
    ...options,
  })
}

export function fetchClientSetup(clientId: string, options?: RequestOptions) {
  return apiFetch(`/api/clients/${clientId}/setup`, {
    schema: () => contract().then((m) => m.clientSetupResponseSchema),
    ...options,
  })
}

/** Setup's "Use an account already connected". Answers the new setup state. */
export function attachClientConnection(
  clientId: string,
  input: ClientAttachConnectionInput
) {
  return apiFetch(`/api/clients/${clientId}/connections`, {
    method: "POST",
    body: input,
    schema: () => contract().then((m) => m.clientSetupResponseSchema),
  })
}

export function createClient(input: ClientCreateInput) {
  return apiFetch("/api/clients", {
    method: "POST",
    body: input,
    schema: () => contract().then((m) => m.clientMutationResponseSchema),
  })
}

export function updateClient(clientId: string, input: ClientUpdateInput) {
  return apiFetch(`/api/clients/${clientId}`, {
    method: "PATCH",
    body: input,
    schema: () => contract().then((m) => m.clientMutationResponseSchema),
  })
}

export function assignLocationsToClient(
  clientId: string,
  input: ClientAssignLocationsInput
) {
  return apiFetch(`/api/clients/${clientId}/locations`, {
    method: "POST",
    body: input,
    schema: () =>
      contract().then((m) => m.clientLocationsAssignedResponseSchema),
  })
}

export function unassignLocationsFromClient(
  clientId: string,
  locationIds: string[]
) {
  return apiFetch(`/api/clients/${clientId}/locations`, {
    method: "DELETE",
    body: { locationIds },
    schema: () =>
      contract().then((m) => m.clientLocationsUnassignedResponseSchema),
  })
}
