"use client"

import { Link2, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType, SVGProps } from "react"

import { settingsGatingFromRole } from "@/lib/settings/gating"
import { cn } from "@/lib/utils"

// Team is now a primary destination, not a settings tab: for an agency, who
// can act on which client is daily work. Listing is gone entirely — it
// administered a location from a page nowhere near it, and that now lives in
// the location's own Access section.
//
// Compliance and Operations are gone too. Data-subject requests, legal holds
// and record export are still served by `app/api/privacy/**` and
// `app/api/legal-holds`, and sync health by `app/api/operations/health` —
// owner/admin-gated on the server, where they were always authorised. What
// they no longer have is a console in a product whose job is replying to
// reviews.
//
// Each area carries the System Settings glyph square: a small tinted tile in
// one of the status solids (or the accent), with the glyph in that solid's
// measured on-colour. The colour is a landmark for the eye, never the only
// signal — the label sits beside it.
const AREAS: {
  href: string
  label: string
  capability: "always" | "canManageConnections"
  icon: ComponentType<SVGProps<SVGSVGElement>>
  tile: string
}[] = [
  {
    href: "/settings",
    label: "Policy",
    capability: "always",
    icon: ShieldCheck,
    tile: "bg-primary text-primary-foreground",
  },
  {
    href: "/settings/connections",
    label: "Connections",
    capability: "canManageConnections",
    icon: Link2,
    tile: "bg-[var(--np-success-solid)] text-[var(--np-success-on-solid)]",
  },
]

/**
 * The settings sidebar, in the System Settings pattern: a column of rows with
 * a leading glyph tile and the selected row on the accent tint. Below `lg` it
 * folds into a horizontally scrolling strip of the same rows so the pattern
 * survives a phone.
 */
export function SettingsNav({
  role,
  className,
}: {
  role: string | null
  className?: string
}) {
  const pathname = usePathname()
  const caps = settingsGatingFromRole(role)
  const visible = AREAS.filter(
    (area) => area.capability === "always" || caps[area.capability]
  )

  return (
    <nav
      aria-label="Settings sections"
      className={cn("-mx-1 overflow-x-auto px-1 lg:mx-0 lg:px-0", className)}
    >
      <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col lg:gap-0.5">
        {visible.map((area) => {
          const isActive =
            area.href === "/settings"
              ? pathname === "/settings"
              : pathname === area.href || pathname.startsWith(`${area.href}/`)
          const Icon = area.icon
          return (
            <li key={area.href}>
              <Link
                href={area.href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-(--np-control-h) items-center gap-2.5 rounded-(--np-radius-control) pr-3 pl-1.5 text-ui font-medium whitespace-nowrap focus-halo transition duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:scale-[0.98]",
                  isActive
                    ? "bg-accent-tint text-accent-ink"
                    : "text-ink hover:bg-fill-tertiary"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-(--np-radius-tag)",
                    area.tile
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                {area.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
