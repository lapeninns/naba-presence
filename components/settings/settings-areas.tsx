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
  SETTINGS_AREA_DEFINITIONS,
  type SettingsAreaDefinition,
} from "@/lib/settings/areas"
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

export type { SettingsAreaCapability } from "@/lib/settings/areas"

/** A settings area as the tab row and the phone's index draw it. */
export type SettingsArea = SettingsAreaDefinition & { icon: React.ReactNode }

const AREA_ICONS: Record<SettingsAreaDefinition["id"], React.ReactNode> = {
  policy: <MessageSquareText />,
  notifications: <Bell />,
  security: <ShieldCheck />,
  team: <Users />,
  connections: <Globe />,
  operations: <Activity />,
  privacy: <Database />,
  usage: <Gauge />,
  billing: <CreditCard />,
}

/**
 * Every settings area, in tab order, with the rule that decides who sees it
 * and its icon. The names, addresses and rules live in lib/settings/areas.ts
 * (plain data, so the breadcrumb trail reads the same names); the tab row
 * (SettingsNav) and the phone's index (SettingsIndex) both read this one
 * list, so they can never disagree. Each page enforces the same rule
 * server-side (AccessDenied / notFound); this only mirrors it.
 */
export const SETTINGS_AREAS: readonly SettingsArea[] =
  SETTINGS_AREA_DEFINITIONS.map((area) => ({
    ...area,
    icon: AREA_ICONS[area.id],
  }))

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
