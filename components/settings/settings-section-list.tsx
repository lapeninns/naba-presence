"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  isSettingsAreaCurrent,
  SETTINGS_GROUPS,
  useVisibleSettingsAreas,
  WithPrivacyAccess,
  type SettingsArea,
} from "@/components/settings/settings-areas"
import type { PrivacyAccess } from "@/lib/settings/gating"
import { cn } from "@/lib/utils"

// The shell's one neutral current-place grammar (components/app-shell/
// nav.tsx): fill, ink, a semibold label and a heavier icon stroke, with no
// accent and no bar.
const ROW_CLASS = cn(
  "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-ui font-medium text-ink-secondary",
  "transition-colors duration-(--np-duration-fast) ease-out-strong hover-fine:hover:bg-fill hover-fine:hover:text-ink",
  "focus-halo focus-visible:outline-none pointer-coarse:min-h-11",
  "aria-[current=page]:bg-fill aria-[current=page]:font-semibold aria-[current=page]:text-ink"
)

function SectionRow({
  area,
  current,
}: {
  area: SettingsArea
  current: boolean
}) {
  return (
    <li>
      <Link
        href={area.href}
        aria-current={current ? "page" : undefined}
        className={ROW_CLASS}
      >
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 [&_svg]:size-4",
            current
              ? "text-ink [&_svg]:stroke-2"
              : "text-ink-muted [&_svg]:stroke-[1.75]"
          )}
        >
          {area.icon}
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{area.label}</span>
      </Link>
    </li>
  )
}

function SectionGroups({
  role,
  privacy,
}: {
  role: string | null
  privacy: PrivacyAccess
}) {
  const pathname = usePathname()
  // The tab row's item source and filter: Team is a primary destination
  // with its own route, so like the tab row the list leaves it to the shell.
  const areas = useVisibleSettingsAreas(role, privacy).filter(
    (area) => !area.indexOnly
  )
  return (
    <>
      {SETTINGS_GROUPS.map((group) => {
        const rows = areas.filter((area) => area.group === group.id)
        if (rows.length === 0) return null
        const labelId = `settings-sections-${group.id}`
        return (
          <div key={group.id} className="flex flex-col gap-1">
            <p
              id={labelId}
              className="px-2.5 text-caption font-medium text-ink-muted"
            >
              {group.header}
            </p>
            <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
              {rows.map((area) => (
                <SectionRow
                  key={area.id}
                  area={area}
                  current={isSettingsAreaCurrent(area, pathname)}
                />
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

/**
 * The settings section list, the first pane of the two-pane settings from
 * md (DIRECTION §7.4): every area this person may open, grouped You /
 * Workspace like the phone's index, the current one in the shell's
 * current-place grammar. Below md it is not drawn: /settings is the index
 * there and the app bar's "‹ Settings" is the way back.
 *
 * "Settings" here is a label, not a heading: each page's own h1 is the one
 * heading that says where you are, and this column sits before it. The
 * nav's name already says it, so assistive tech skips the visible word.
 */
export function SettingsSectionList({
  role,
  className,
}: {
  role: string | null
  className?: string
}) {
  return (
    <nav
      aria-label="Settings sections"
      data-slot="settings-section-list"
      className={cn("flex flex-col gap-4 max-md:hidden", className)}
    >
      <p className="px-2.5 text-title font-semibold text-ink" aria-hidden>
        Settings
      </p>
      <WithPrivacyAccess role={role}>
        {(privacy) => <SectionGroups role={role} privacy={privacy} />}
      </WithPrivacyAccess>
    </nav>
  )
}
