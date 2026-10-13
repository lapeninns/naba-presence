import type {
  ClientAssignLocationsInput,
  ClientAttachConnectionInput,
  ClientCreateInput,
  ClientUpdateInput,
} from "@/lib/contracts/clients"

import { apiFetch } from "./client"

// Schemas load on demand (see `ResponseSchema` in ./client): the sidebar
// reads the client list on every page, and the contract pulls in zod.
const contract = () => import("@/lib/contracts/clients")

export function fetchClients(signal?: AbortSignal) {
  return apiFetch("/api/clients", {
    schema: () => contract().then((m) => m.clientsResponseSchema),
    signal,
  })
}

/** Archived clients only, for the Clients page's Archived view. */
export function fetchArchivedClients(signal?: AbortSignal) {
  return apiFetch("/api/clients?archived=1", {
    schema: () => contract().then((m) => m.clientsResponseSchema),
    signal,
  })
}

export function fetchClient(clientId: string, signal?: AbortSignal) {
  return apiFetch(`/api/clients/${clientId}`, {
    schema: () => contract().then((m) => m.clientResponseSchema),
    signal,
  })
}

export function fetchClientSetup(clientId: string, signal?: AbortSignal) {
  return apiFetch(`/api/clients/${clientId}/setup`, {
    schema: () => contract().then((m) => m.clientSetupResponseSchema),
    signal,
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
