/**
 * Words and routing rules that depend on the workspace mode.
 *
 * Pure and client-safe, so server pages, client components and tests read
 * the same table. A business-mode owner never sees "client" or "agency":
 * components take their words from `workspaceTerms` instead of branching
 * inline, and the mode-specific routes answer through `businessModeRedirect`.
 */
import type { WorkspaceMode } from "@/lib/contracts/session"

export type { WorkspaceMode }

export type WorkspaceTerms = {
  /** What the account is called: the sidebar, Settings, invitations. */
  org: "Business" | "Agency"
  orgLower: "business" | "agency"
  /** The thing access and sharing are scoped by. */
  scope: "location" | "client"
  scopePlural: "locations" | "clients"
  /** Capitalised, for headings and table columns. */
  scopeTitle: "Location" | "Client"
  scopePluralTitle: "Locations" | "Clients"
  /** The Team dialog and column that decide who sees what. */
  access: "Location access" | "Client access"
  /** The label on the name field. */
  orgName: "Business name" | "Agency name"
  reportsDescription: string
  teamDescription: string
}

const TERMS: Record<WorkspaceMode, WorkspaceTerms> = {
  business: {
    org: "Business",
    orgLower: "business",
    scope: "location",
    scopePlural: "locations",
    scopeTitle: "Location",
    scopePluralTitle: "Locations",
    access: "Location access",
    orgName: "Business name",
    reportsDescription:
      "How your locations are performing on Google — replies, visibility and search keywords.",
    teamDescription: "Who can see and act on your reviews and settings.",
  },
  agency: {
    org: "Agency",
    orgLower: "agency",
    scope: "client",
    scopePlural: "clients",
    scopeTitle: "Client",
    scopePluralTitle: "Clients",
    access: "Client access",
    orgName: "Agency name",
    reportsDescription:
      "How your clients are performing on Google — replies, visibility and search keywords.",
    teamDescription:
      "Who can see and act on your clients’ reviews and settings.",
  },
}

export function workspaceTerms(mode: WorkspaceMode): WorkspaceTerms {
  return TERMS[mode]
}

/**
 * Where a client-layer address goes in business mode, or null when the path
 * is not one of them. `/clients/[id]/settings` is where a business keeps its
 * name and defaults, so it lands on Settings; everything else under
 * `/clients` lands on Listings. The query string is dropped on purpose: a
 * `?clientId=` or `?view=archived` means nothing without the client layer.
 */
export function businessModeRedirect(pathname: string): string | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "")
  if (path === "/clients" || path === "/clients/new") return "/listings"
  const match = /^\/clients\/[^/]+(\/.*)?$/.exec(path)
  if (!match) return null
  const rest = match[1] ?? ""
  return rest === "/settings" || rest.startsWith("/settings/")
    ? "/settings"
    : "/listings"
}
