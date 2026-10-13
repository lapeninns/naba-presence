/**
 * The settings areas as plain data: the one list of their names, addresses
 * and who may open them. components/settings/settings-areas.tsx adds an icon
 * to each for the tab row and the phone's settings index, and
 * lib/ui/breadcrumb-trail.ts names a /settings/<section> crumb from it, so a
 * section is called the same thing in its tab, its index row, its h1 and the
 * trail. No React here, so the trail (and its unit tests) can read it
 * without pulling in the client-only area hooks.
 */

export type SettingsAreaCapability =
  | "always"
  | "canManageConnections"
  | "canManageTeam"
  | "canViewPrivacy"
  | "mfa"
  | "owner"

export type SettingsAreaDefinition = {
  id:
    | "policy"
    | "notifications"
    | "security"
    | "team"
    | "connections"
    | "operations"
    | "privacy"
    | "usage"
    | "billing"
  href: string
  /** One name everywhere: the tab, the index row, the page's h1 and the trail. */
  label: string
  /** The index row's one line of what is inside. */
  description: string
  /** Personal areas are the signed-in person's own; workspace areas are shared. */
  group: "personal" | "workspace"
  capability: SettingsAreaCapability
  /** Shown only while billing is switched on (BillingScreensProvider). */
  billing?: true
  /** On the phone's index only, never a settings tab (it lives elsewhere). */
  indexOnly?: true
}

/** Every settings area, in tab order. */
export const SETTINGS_AREA_DEFINITIONS: readonly SettingsAreaDefinition[] = [
  {
    id: "policy",
    href: "/settings/policy",
    label: "Reply policy",
    description: "Approval, review retention and the defaults new work uses",
    group: "workspace",
    capability: "always",
  },
  {
    id: "notifications",
    href: "/settings/notifications",
    label: "Notifications",
    description: "What you hear about, in the app and by email",
    group: "personal",
    capability: "always",
  },
  // Two-step verification is per person, so every role sees it once the
  // MFA_ENABLED flag is on (P02-S8).
  {
    id: "security",
    href: "/settings/security",
    label: "Sign-in security",
    description: "Two-step verification for your sign-in",
    group: "personal",
    capability: "mfa",
  },
  {
    id: "team",
    href: "/team",
    label: "Team",
    description: "People, their roles and what they can publish",
    group: "workspace",
    capability: "canManageTeam",
    indexOnly: true,
  },
  {
    id: "connections",
    href: "/settings/connections",
    label: "Google connections",
    description: "Google logins, and real-time review alerts",
    group: "workspace",
    capability: "canManageConnections",
  },
  {
    id: "operations",
    href: "/settings/operations",
    label: "Operations",
    description: "Scheduler, sync, queued work and email health",
    group: "workspace",
    capability: "canManageConnections",
  },
  {
    id: "privacy",
    href: "/settings/privacy",
    label: "Data and privacy",
    description: "Reviewers’ data requests, legal holds and exports",
    group: "workspace",
    capability: "canViewPrivacy",
  },
  // Plan P07-S6: the shared Usage screen and the owner-only Billing screen.
  {
    id: "usage",
    href: "/settings/usage",
    label: "Usage",
    description: "AI reply credits and the locations your plan covers",
    group: "workspace",
    capability: "always",
    billing: true,
  },
  {
    id: "billing",
    href: "/settings/billing",
    label: "Billing",
    description: "Your plan, payment details and invoices",
    group: "workspace",
    capability: "owner",
    billing: true,
  },
]

/**
 * The /settings/<section> pages by their path segment, named as their tab
 * names them. Areas that live elsewhere (Team is /team) are not sections.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(
    SETTINGS_AREA_DEFINITIONS.flatMap((area) => {
      const match = /^\/settings\/([^/]+)$/.exec(area.href)
      return match ? [[match[1], area.label] as const] : []
    })
  )
