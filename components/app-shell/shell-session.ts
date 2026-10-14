import type { WorkspaceMode } from "@/lib/workspace/terms"

/**
 * What the app shell shows about the signed-in session: names, role and
 * workspace mode for the navigation and account menu, and the support
 * marker for the impersonation banner. Nothing else crosses into the client
 * shell's props, which are serialised into the RSC flight payload: the
 * session id, access and assurance fields of the server `Session` stay on
 * the server (audit 2026-10-14, P3).
 */
export type ShellSession = {
  organisationId: string
  organisationName: string
  displayName: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  workspaceMode: WorkspaceMode
  /** Set only inside a support impersonation session. */
  supportActor?: string | null
}

/**
 * The display fields of a server session, picked by name so a field added
 * to `Session` never reaches the browser by default. Plain, not a client
 * module, so the server layout can call it.
 */
export function toShellSession(session: ShellSession): ShellSession {
  return {
    organisationId: session.organisationId,
    organisationName: session.organisationName,
    displayName: session.displayName,
    email: session.email,
    role: session.role,
    workspaceMode: session.workspaceMode,
    supportActor: session.supportActor ?? null,
  }
}
