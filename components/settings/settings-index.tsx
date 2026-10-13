"use client"

import {
  useVisibleSettingsAreas,
  WithPrivacyAccess,
  type SettingsArea,
} from "@/components/settings/settings-areas"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { settingsGatingFromRole, type PrivacyAccess } from "@/lib/settings/gating"

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
          <GroupedList
            key={group.id}
            header={group.header}
            footer={group.footer}
          >
            {rows.map((area) => (
              <GroupedListItem
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
          </GroupedList>
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
export function SettingsIndex({ role }: { role: string | null }) {
  return (
    <WithPrivacyAccess role={role}>
      {(privacy) => <SettingsIndexGroups role={role} privacy={privacy} />}
    </WithPrivacyAccess>
  )
}
