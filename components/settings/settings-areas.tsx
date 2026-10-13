"use client"

import { QueryClientContext } from "@tanstack/react-query"
import {
  Activity,
  Bell,
  CreditCard,
  Database,
  Gauge,
  Globe,
  MessageSquareText,
  ShieldCheck,
  Users,
} from "lucide-react"
import * as React from "react"

import { useBillingScreensEnabled } from "@/components/settings/billing-screens"
import { useSettingsFeatures } from "@/components/settings/settings-features"
import { useSettingsCapabilities } from "@/lib/queries/use-settings-capabilities"
import {
  privacyGating,
  settingsGatingFromRole,
  type PrivacyAccess,
} from "@/lib/settings/gating"

// Team is a primary destination, not a settings tab: for an agency, who can
// act on which client is daily work. It is offered on the phone's settings
// index (owners and admins only, as on the shell's nav) but never as a tab.
// Listing is gone entirely — it administered a location from a page nowhere
// near it, and that now lives in the location's own Access section.
//
// The old Compliance console is gone. Data and privacy (plan P04-7) is its
// owner-facing successor: requests, legal holds, subject export and retention
// status, shown once the organisation's `privacy_settings` feature is on
// (settings capabilities `privacy`). Operations returned for owners and
// admins as the operational recovery view (scheduler, sync freshness, queued
// work, unresolved writes, email delivery) the GBP operations brief requires.

export type SettingsAreaCapability =
  | "always"
  | "canManageConnections"
  | "canManageTeam"
  | "canViewPrivacy"
  | "mfa"
  | "owner"

export type SettingsArea = {
  id: string
  href: string
  /** One name everywhere: the tab, the index row and the page's h1. */
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
  icon: React.ReactNode
}

/**
 * Every settings area, in tab order, with the rule that decides who sees it.
 * The tab row (SettingsNav) and the phone's index (SettingsIndex) both read
 * this one list, so they can never disagree. Each page enforces the same
 * rule server-side (AccessDenied / notFound); this only mirrors it.
 */
export const SETTINGS_AREAS: readonly SettingsArea[] = [
  {
    id: "policy",
    href: "/settings/policy",
    label: "Reply policy",
    description: "Approval, review retention and the defaults new work uses",
    group: "workspace",
    capability: "always",
    icon: <MessageSquareText />,
  },
  {
    id: "notifications",
    href: "/settings/notifications",
    label: "Notifications",
    description: "What you hear about, in the app and by email",
    group: "personal",
    capability: "always",
    icon: <Bell />,
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
    icon: <ShieldCheck />,
  },
  {
    id: "team",
    href: "/team",
    label: "Team",
    description: "People, their roles and what they can publish",
    group: "workspace",
    capability: "canManageTeam",
    indexOnly: true,
    icon: <Users />,
  },
  {
    id: "connections",
    href: "/settings/connections",
    label: "Google connections",
    description: "Google logins, and real-time review alerts",
    group: "workspace",
    capability: "canManageConnections",
    icon: <Globe />,
  },
  {
    id: "operations",
    href: "/settings/operations",
    label: "Operations",
    description: "Scheduler, sync, queued work and email health",
    group: "workspace",
    capability: "canManageConnections",
    icon: <Activity />,
  },
  {
    id: "privacy",
    href: "/settings/privacy",
    label: "Data and privacy",
    description: "Reviewers’ data requests, legal holds and exports",
    group: "workspace",
    capability: "canViewPrivacy",
    icon: <Database />,
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
    icon: <Gauge />,
  },
  {
    id: "billing",
    href: "/settings/billing",
    label: "Billing",
    description: "Your plan, payment details and invoices",
    group: "workspace",
    capability: "owner",
    billing: true,
    icon: <CreditCard />,
  },
]

/**
 * Whether `pathname` is inside `area`. Reply policy has two addresses:
 * `/settings` (its desk home) and `/settings/policy` (where the phone's
 * index row leads).
 */
export function isSettingsAreaCurrent(
  area: SettingsArea,
  pathname: string | null
): boolean {
  if (!pathname) return false
  if (area.id === "policy") {
    return pathname === "/settings" || pathname === area.href
  }
  return pathname === area.href || pathname.startsWith(`${area.href}/`)
}

/** The areas `role` may open, given the deployment and organisation switches. */
export function useVisibleSettingsAreas(
  role: string | null,
  privacy: PrivacyAccess
): SettingsArea[] {
  const features = useSettingsFeatures()
  const billing = useBillingScreensEnabled()
  const caps = { ...settingsGatingFromRole(role), ...privacyGating(privacy) }
  return SETTINGS_AREAS.filter((area) => {
    if (area.billing && !billing) return false
    switch (area.capability) {
      case "always":
        return true
      case "mfa":
        return features.mfa
      case "owner":
        return role === "owner"
      default:
        return caps[area.capability]
    }
  })
}

function PrivacyAccessFromQuery({
  role,
  children,
}: {
  role: string | null
  children: (privacy: PrivacyAccess) => React.ReactNode
}) {
  const managerial = role === "owner" || role === "admin"
  const caps = useSettingsCapabilities({ enabled: managerial })
  return <>{children(managerial ? (caps.data?.privacy ?? "none") : "none")}</>
}

/**
 * Reads the `privacy` settings capability the settings layout hydrates.
 * Outside a query client (a bare render) the privacy area is simply not
 * offered.
 */
export function WithPrivacyAccess({
  role,
  children,
}: {
  role: string | null
  children: (privacy: PrivacyAccess) => React.ReactNode
}) {
  const client = React.useContext(QueryClientContext)
  return client ? (
    <PrivacyAccessFromQuery role={role}>{children}</PrivacyAccessFromQuery>
  ) : (
    <>{children("none")}</>
  )
}
