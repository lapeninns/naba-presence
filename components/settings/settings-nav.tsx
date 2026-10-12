"use client"

import { QueryClientContext } from "@tanstack/react-query"
import { usePathname } from "next/navigation"
import { useContext } from "react"

import { useBillingScreensEnabled } from "@/components/settings/billing-screens"
import { useSettingsFeatures } from "@/components/settings/settings-features"
import { TabNav } from "@/components/ui/tabs"
import { useSettingsCapabilities } from "@/lib/queries/use-settings-capabilities"
import {
  privacyGating,
  settingsGatingFromRole,
  type PrivacyAccess,
} from "@/lib/settings/gating"

// Team is now a primary destination, not a settings tab: for an agency, who
// can act on which client is daily work. Listing is gone entirely — it
// administered a location from a page nowhere near it, and that now lives in
// the location's own Access section.
//
// The old Compliance console is gone. Data and privacy (plan P04-7) is its
// owner-facing successor: requests, legal holds, subject export and retention
// status, shown once the organisation's `privacy_settings` feature is on
// (settings capabilities `privacy`). Operations returned for owners and
// admins as the operational recovery view (scheduler, sync freshness, queued
// work, unresolved writes, email delivery) the GBP operations brief requires.
const AREAS: {
  href: string
  label: string
  capability:
    | "always"
    | "canManageConnections"
    | "canViewPrivacy"
    | "mfa"
    | "owner"
  /** Shown only while billing is switched on (BillingScreensProvider). */
  billing?: true
}[] = [
  { href: "/settings", label: "Policy", capability: "always" },
  { href: "/settings/notifications", label: "Notifications", capability: "always" },
  // Two-step verification is per person, so every role sees it once the
  // MFA_ENABLED flag is on (P02-S8).
  { href: "/settings/security", label: "Sign-in security", capability: "mfa" },
  {
    href: "/settings/connections",
    label: "Google connections",
    capability: "canManageConnections",
  },
  {
    href: "/settings/operations",
    label: "Operations",
    capability: "canManageConnections",
  },
  {
    href: "/settings/privacy",
    label: "Data and privacy",
    capability: "canViewPrivacy",
  },
  // Plan P07-S6: the shared Usage screen and the owner-only Billing screen.
  { href: "/settings/usage", label: "Usage", capability: "always", billing: true },
  { href: "/settings/billing", label: "Billing", capability: "owner", billing: true },
]

type SettingsNavProps = { role: string | null; className?: string }

function SettingsNavTabs({
  role,
  className,
  privacy,
}: SettingsNavProps & { privacy: PrivacyAccess }) {
  const pathname = usePathname()
  const caps = { ...settingsGatingFromRole(role), ...privacyGating(privacy) }
  const features = useSettingsFeatures()
  const billing = useBillingScreensEnabled()
  const items = AREAS.filter(
    (area) =>
      (!area.billing || billing) &&
      (area.capability === "always"
        ? true
        : area.capability === "mfa"
          ? features.mfa
          : area.capability === "owner"
            ? role === "owner"
            : caps[area.capability])
  ).map((area) => ({
    href: area.href,
    label: area.label,
    current:
      area.href === "/settings"
        ? pathname === "/settings"
        : pathname === area.href || pathname.startsWith(`${area.href}/`),
  }))

  return (
    <TabNav
      aria-label="Settings sections"
      items={items}
      className={className}
    />
  )
}

/** Reads the `privacy` settings capability the settings layout hydrates. */
function SettingsNavWithCapabilities(props: SettingsNavProps) {
  const managerial = props.role === "owner" || props.role === "admin"
  const caps = useSettingsCapabilities({ enabled: managerial })
  return (
    <SettingsNavTabs
      {...props}
      privacy={managerial ? (caps.data?.privacy ?? "none") : "none"}
    />
  )
}

/**
 * The settings sub-navigation (reference `settings-subnav`): link tabs under
 * each settings page's header, the current one underlined in ink. A member
 * or viewer sees Policy and Notifications; Google connections and Operations
 * are for owners and admins, and Data and privacy for owners and admins of
 * an organisation with the area switched on. Outside a query client (a bare
 * render) the privacy area is simply not offered.
 */
export function SettingsNav(props: SettingsNavProps) {
  const client = useContext(QueryClientContext)
  return client ? (
    <SettingsNavWithCapabilities {...props} />
  ) : (
    <SettingsNavTabs {...props} privacy="none" />
  )
}
