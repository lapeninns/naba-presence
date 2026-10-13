"use client"

import {
  useVisibleSettingsAreas,
  WithPrivacyAccess,
  type SettingsArea,
} from "@/components/settings/settings-areas"
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-list"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  MEMBER_ROLES,
  roleLabel,
  type MemberRole,
} from "@/lib/settings/member-roles"
import {
  settingsGatingFromRole,
  type PrivacyAccess,
} from "@/lib/settings/gating"

// "You" is reserved for the signed-in person's own settings
// (settings-setup-auth-24): today Notifications and Sign-in security. A
// signed-in account area (name, change password) belongs here once the API
// has one; nothing is offered before it exists.
const GROUPS: { id: SettingsArea["group"]; header: string; footer: string }[] =
  [
    {
      id: "personal",
      header: "You",
      footer: "Only you. Your choices here don’t change anyone else’s.",
    },
    {
      id: "workspace",
      header: "Workspace",
      footer: "Shared by everyone in the workspace.",
    },
  ]

function SettingsIndexGroups({
  role,
  privacy,
}: {
  role: string | null
  privacy: PrivacyAccess
}) {
  const areas = useVisibleSettingsAreas(role, privacy)
  // The same role projection the server answers settings capabilities with.
  const canEditPolicy = settingsGatingFromRole(role).canEditSettings
  return (
    <nav aria-label="Settings" className="flex flex-col gap-(--np-gap-section)">
      {GROUPS.map((group) => {
        const rows = areas.filter((area) => area.group === group.id)
        if (rows.length === 0) return null
        return (
          <SettingsGroup
            key={group.id}
            label={group.header}
            footer={group.footer}
          >
            {rows.map((area) => (
              <SettingsRow
                key={area.id}
                href={area.href}
                icon={area.icon}
                label={area.label}
                description={area.description}
                trailing={
                  area.id === "policy" && !canEditPolicy ? "View only" : null
                }
              />
            ))}
          </SettingsGroup>
        )
      })}
    </nav>
  )
}

/**
 * The phone's settings home: every area the signed-in person may open, as
 * grouped rows (their own preferences, then the workspace's), so nobody
 * lands inside a form they can't change. Reads the same area list and rules
 * as the tab row (settings-areas.tsx). Desks never see it: /settings shows
 * Reply policy with the tab row there, chosen in CSS (app/(dashboard)/
 * settings/page.tsx). Members and viewers see Reply policy marked "View
 * only", so they know before opening it that it can't be changed.
 */
export type SettingsProfile = {
  displayName: string | null
  email: string | null
  organisationName: string | null
}

function initialsOf(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
}

/**
 * Who is signed in and to which workspace, at the top of the phone index
 * (Notion Mail's settings profile header). Read-only: there is no account
 * editing API, so it offers nothing to change.
 */
function SettingsProfileHeader({
  profile,
  role,
}: {
  profile: SettingsProfile
  role: string | null
}) {
  const name = profile.displayName || profile.email
  if (!name) return null
  const roleName = MEMBER_ROLES.includes(role as MemberRole)
    ? roleLabel(role as MemberRole)
    : null
  const context = [roleName, profile.organisationName]
    .filter(Boolean)
    .join(" · ")
  return (
    <section
      aria-label="Signed in as"
      className="flex flex-col items-center gap-1 py-2 text-center"
    >
      <Avatar size="lg" className="mb-1">
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <p className="text-title font-semibold [overflow-wrap:anywhere] text-ink">
        {name}
      </p>
      {profile.displayName && profile.email ? (
        <p className="text-ui [overflow-wrap:anywhere] text-ink-muted">
          {profile.email}
        </p>
      ) : null}
      {context ? (
        <p className="text-caption text-ink-muted">{context}</p>
      ) : null}
    </section>
  )
}

export function SettingsIndex({
  role,
  profile,
}: {
  role: string | null
  profile?: SettingsProfile
}) {
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {profile ? <SettingsProfileHeader profile={profile} role={role} /> : null}
      <WithPrivacyAccess role={role}>
        {(privacy) => <SettingsIndexGroups role={role} privacy={privacy} />}
      </WithPrivacyAccess>
    </div>
  )
}
