"use client"

import { ChevronsUpDown, LogOut } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { apiFetch } from "@/lib/api/client"
import { signOut } from "@/lib/api/auth"
import { z } from "zod"

import type { ShellSession } from "./app-shell"

const organisationsSchema = z.object({
  items: z.array(
    z.object({ organisationId: z.string(), name: z.string(), role: z.string() })
  ),
})

const ROLE_EXPLANATION: Record<string, string> = {
  owner: "Full access, including compliance and billing",
  admin: "Manages clients, connections and the team",
  member: "Replies to reviews and edits assigned clients",
  viewer: "Read-only",
}

function initialsFor(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return letters || "AC"
}

async function handleSignOut() {
  try {
    await signOut()
  } catch {
    // Best-effort: a failed clear is recoverable server-side, but a user
    // stranded on a dashboard they believe they have left is not.
  } finally {
    window.location.assign("/sign-in")
  }
}

/**
 * Identity, role and the way out.
 *
 * The role is spelled out rather than shown as a bare lowercase word: "member"
 * on its own does not tell anyone what they may do, and the first question a
 * new teammate asks is why a button is disabled.
 *
 * Switching organisations lives here and only here. Most people belong to one,
 * and the item is hidden for them; the agency's own clients are a level inside
 * the organisation, not separate organisations, so this is a rare
 * account-level action rather than product navigation.
 */
function AccountMenu({ session }: { session: ShellSession | null }) {
  const displayName = session?.displayName ?? "Account"
  const role = session?.role

  const organisations = useQuery({
    queryKey: ["organisations"],
    queryFn: ({ signal }) =>
      apiFetch("/api/organisations", { schema: organisationsSchema, signal }),
    enabled: Boolean(session),
    staleTime: 5 * 60 * 1000,
  })
  const others =
    organisations.data?.items.filter(
      (item) => item.organisationId !== session?.organisationId
    ) ?? []

  const [switching, setSwitching] = React.useState(false)
  const switchTo = async (organisationId: string) => {
    setSwitching(true)
    try {
      await apiFetch("/api/session/switch", {
        method: "POST",
        body: { organisationId },
        schema: z.unknown(),
      })
      // A full reload, not a router push: switching mints a new session and
      // every cached query in memory belongs to the previous organisation.
      window.location.assign("/home")
    } catch {
      setSwitching(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-(--np-radius-control) px-2 py-1.5 text-left transition-colors duration-(--np-duration-fast) hover:bg-[var(--np-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunken text-caption font-semibold"
        >
          {initialsFor(displayName)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-medium">{displayName}</span>
          {role ? (
            <span className="truncate text-caption text-ink-muted capitalize">
              {role}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64">
        <div className="px-3 py-2">
          <p className="truncate text-ui font-medium">{displayName}</p>
          <p className="truncate text-caption text-ink-muted">{session?.email}</p>
          {role ? (
            <p className="mt-1.5 text-caption text-ink-muted">
              <span className="font-medium capitalize">{role}</span>
              {ROLE_EXPLANATION[role] ? ` · ${ROLE_EXPLANATION[role]}` : ""}
            </p>
          ) : null}
        </div>
        {others.length > 0 ? (
          <>
            <div className="my-1 h-px bg-line-subtle" />
            <p className="px-3 py-1 text-caption font-medium text-ink-faint">
              Switch organisation
            </p>
            {others.map((organisation) => (
              <DropdownMenuItem
                key={organisation.organisationId}
                disabled={switching}
                onClick={() => void switchTo(organisation.organisationId)}
              >
                <span className="truncate">{organisation.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <div className="my-1 h-px bg-line-subtle" />
        <DropdownMenuItem onClick={() => void handleSignOut()}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AccountMenu }
