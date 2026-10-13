import { apiFetch, type RequestOptions } from "./client"
import type { WorkspaceMode } from "@/lib/contracts/session"

// Schemas load on demand (see `ResponseSchema` in ./client): the app shell
// reads the session on every page, and the contract pulls in zod. Server
// code takes `sessionSchema` from lib/contracts/session directly.
export type { SessionResponse, SessionUser } from "@/lib/contracts/session"

const contract = () => import("@/lib/contracts/session")

export function fetchSession(options?: RequestOptions) {
  return apiFetch("/api/session", {
    schema: () => contract().then((m) => m.sessionResponseSchema),
    ...options,
  })
}

/** GET /api/organisations: every organisation this person belongs to. */
export function fetchOrganisations(options?: RequestOptions) {
  return apiFetch("/api/organisations", {
    schema: () => contract().then((m) => m.organisationsResponseSchema),
    ...options,
  })
}

/** Renames the session's organisation (owner only). */
export async function renameOrganisation(name: string) {
  const { organisation } = await apiFetch("/api/organisations", {
    method: "PATCH",
    body: { name },
    schema: () => contract().then((m) => m.organisationRenamedResponseSchema),
  })
  return organisation
}

/**
 * Switches the session's organisation between business and agency mode
 * (owner only, behind the `workspace_mode_change` feature).
 */
export function changeWorkspaceMode(
  workspaceMode: WorkspaceMode,
  options: { confirmReportShares?: boolean } = {}
) {
  return apiFetch("/api/organisations", {
    method: "PATCH",
    body: {
      workspaceMode,
      ...(options.confirmReportShares ? { confirmReportShares: true } : {}),
    },
    schema: () =>
      contract().then((m) => m.organisationModeChangedResponseSchema),
  })
}
