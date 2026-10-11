import { apiFetch, type RequestOptions } from "./client"
import {
  organisationModeChangedResponseSchema,
  organisationRenamedResponseSchema,
  type WorkspaceMode,
  sessionResponseSchema,
} from "@/lib/contracts/session"

export {
  sessionResponseSchema,
  sessionSchema,
  type SessionResponse,
  type SessionUser,
} from "@/lib/contracts/session"

export function fetchSession(options?: RequestOptions) {
  return apiFetch("/api/session", { schema: sessionResponseSchema, ...options })
}

/** Renames the session's organisation (owner only). */
export async function renameOrganisation(name: string) {
  const { organisation } = await apiFetch("/api/organisations", {
    method: "PATCH",
    body: { name },
    schema: organisationRenamedResponseSchema,
  })
  return organisation
}

/**
 * Switches the session's organisation between business and agency mode
 * (owner only, behind the `workspace_mode_change` feature).
 */
export function changeWorkspaceMode(workspaceMode: WorkspaceMode) {
  return apiFetch("/api/organisations", {
    method: "PATCH",
    body: { workspaceMode },
    schema: organisationModeChangedResponseSchema,
  })
}
