"use client"

import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import {
  isSettingsAreaCurrent,
  useVisibleSettingsAreas,
  WithPrivacyAccess,
} from "@/components/settings/settings-areas"
import { TabNav } from "@/components/ui/tabs"
import type { PrivacyAccess } from "@/lib/settings/gating"
import { cn } from "@/lib/utils"

type SettingsNavProps = { role: string | null; className?: string }

/**
 * Brings the current tab into view in the sideways-scrolling tab row. Each
 * settings page mounts its own nav, so without this a narrow row always
 * opened on its first tabs and never showed where you are
 * (settings-setup-auth-02). `inline: "nearest"` moves the row only as far
 * as it must, `block: "nearest"` leaves the page alone when the row is
 * already on screen, and "instant" keeps the first paint still. The Tabs
 * primitive doesn't do this yet; when it does, this hook goes.
 */
function useCurrentTabInView(
  ref: React.RefObject<HTMLElement | null>,
  pathname: string | null
) {
  React.useLayoutEffect(() => {
    const link = ref.current?.querySelector<HTMLElement>(
      "[aria-current='page']"
    )
    // jsdom has no scrollIntoView; a real browser always does.
    link?.scrollIntoView?.({
      behavior: "instant",
      block: "nearest",
      inline: "nearest",
    })
  }, [ref, pathname])
}

function SettingsNavTabs({
  role,
  className,
  privacy,
}: SettingsNavProps & { privacy: PrivacyAccess }) {
  const pathname = usePathname()
  const ref = React.useRef<HTMLDivElement>(null)
  useCurrentTabInView(ref, pathname)
  const items = useVisibleSettingsAreas(role, privacy)
    .filter((area) => !area.indexOnly)
    .map((area) => ({
      href: area.href,
      label: area.label,
      current: isSettingsAreaCurrent(area, pathname),
    }))

  return (
    <div ref={ref} className={cn("flex min-w-0 flex-col gap-2", className)}>
      {/* Below md the settings home is an index of areas
          (settings-index.tsx), so an area page leads back to it instead of
          carrying a tab row that can't fit. From md the tab row is the way
          round, on every settings page. */}
      <Link
        href="/settings"
        className="-ml-1 inline-flex min-h-(--np-touch) items-center gap-1 self-start rounded-(--np-radius-control) pr-2 text-ui font-medium text-ink-secondary no-underline focus-halo hover-fine:text-ink md:hidden"
      >
        <ChevronLeft aria-hidden className="size-4" strokeWidth={1.75} />
        All settings
      </Link>
      <TabNav
        aria-label="Settings sections"
        items={items}
        className="max-md:hidden"
      />
    </div>
  )
}

/**
 * The settings sub-navigation (reference `settings-subnav`): from md, link
 * tabs under each settings page's header, the current one underlined in ink
 * and kept in view; below md, a way back to the settings index. A member or viewer sees Reply policy and Notifications; Google
 * connections and Operations are for owners and admins, and Data and privacy
 * for owners and admins of an organisation with the area switched on. The
 * areas and their rules live in settings-areas.tsx, shared with the phone's
 * settings index.
 */
export function SettingsNav(props: SettingsNavProps) {
  return (
    <WithPrivacyAccess role={props.role}>
      {(privacy) => <SettingsNavTabs {...props} privacy={privacy} />}
    </WithPrivacyAccess>
  )
}
