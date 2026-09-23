"use client"

import {
  ArrowLeft,
  BarChart3,
  Building2,
  ChevronRight,
  Inbox,
  Search,
  Settings,
  Store,
  Users,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  openCommandPalette,
  useShortcutHint,
} from "@/components/app-shell/command-palette"
import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import { Code } from "@/components/app-shell/system-page"
import { Button, buttonVariants } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

const DESTINATIONS = [
  {
    href: "/inbox",
    label: "Inbox",
    description: "Reviews that need a reply, an approval or a retry",
    icon: Inbox,
  },
  {
    href: "/listings",
    label: "Listings",
    description: "Every Google Business Profile, health first",
    icon: Store,
  },
  {
    href: "/clients",
    label: "Clients",
    description: "The businesses you look after and their Google connections",
    icon: Building2,
  },
  {
    href: "/reports",
    label: "Reports",
    description: "Ratings, reply times and profile views by client",
    icon: BarChart3,
  },
  {
    href: "/team",
    label: "Team",
    description: "People and what each can reach",
    icon: Users,
    managersOnly: true,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Reply policy, Google connections and notifications",
    icon: Settings,
  },
] as const

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation, and a list of where
 * they can go instead. Team is offered only to the roles that can open it.
 */
export default function DashboardNotFound() {
  const pathname = usePathname()
  const role = useSessionRole()
  const shortcut = useShortcutHint()
  const manager = role === "owner" || role === "admin"
  const destinations = DESTINATIONS.filter(
    (destination) => !("managersOnly" in destination) || manager
  )

  return (
    <PageFrame>
      <PageEmptyState
        icon={<Search strokeWidth={1.75} />}
        eyebrow="Page not found · 404"
        title="This page doesn’t exist"
        description="The client, listing or page you followed may have been removed, or the link may be wrong. Nothing was changed."
        action={
          <>
            <Link
              href="/inbox"
              className={cn(buttonVariants(), "pointer-coarse:min-h-11")}
            >
              <ArrowLeft strokeWidth={1.75} aria-hidden />
              Back to Inbox
            </Link>
            <Button
              type="button"
              variant="outline"
              className="pointer-coarse:min-h-11"
              onClick={openCommandPalette}
            >
              <Search strokeWidth={1.75} aria-hidden />
              Search clients and listings
              <Kbd aria-hidden className="ml-1 max-md:hidden">
                {shortcut}
              </Kbd>
            </Button>
          </>
        }
      >
        {pathname ? (
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-ui text-ink-muted">
            You asked for <Code>{pathname}</Code>
          </p>
        ) : null}
      </PageEmptyState>

      <section aria-labelledby="where-to-go" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="where-to-go" className="text-section font-semibold text-ink">
            Where to go instead
          </h2>
          <p className="text-ui text-ink-muted">
            The parts of NabaPresence you can reach from here.
          </p>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-3">
          {destinations.map((destination) => (
            <li key={destination.href} className="flex">
              <Link
                href={destination.href}
                className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line bg-surface p-4 focus-halo transition-[border-color,box-shadow] duration-(--np-duration-fast) hover:border-line-strong hover:shadow-np-raised focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className="grid size-9 place-items-center rounded-[10px] bg-surface-alt text-ink-secondary"
                >
                  <destination.icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-ink">
                    {destination.label}
                  </span>
                  <span className="text-ui text-ink-muted">
                    {destination.description}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 text-ink-muted"
                  strokeWidth={1.75}
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="link-help"
        className="flex flex-col gap-1.5 rounded-lg bg-surface-alt p-4"
      >
        <h2 id="link-help" className="text-body font-semibold text-ink">
          Followed a link from a teammate?
        </h2>
        <p className="text-ui text-ink-muted">
          Ask them to open it again. If it still fails, the client or listing
          was probably removed. If you can’t see a client they can, an owner or
          admin can give you access from the Team page.
        </p>
      </section>
    </PageFrame>
  )
}
