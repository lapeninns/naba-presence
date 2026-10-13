"use client"

import { QueryClientContext } from "@tanstack/react-query"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { toast } from "@/components/ui/toast"
import { healthLabel } from "@/lib/clients/health"
import {
  clientPageKind,
  clientSwitchTarget,
  currentClientId,
} from "@/lib/clients/scope"
import type { ClientSummary } from "@/lib/contracts/clients"
import type { SessionResponse } from "@/lib/contracts/session"
import { guardNavigation } from "@/lib/editors/use-leave-guard"
import type { DirectoryEntry } from "@/lib/locations/directory"
import { queryKeys } from "@/lib/queries/keys"
import { useClients } from "@/lib/queries/use-clients"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import {
  usePageClientScope,
  usePageScopeHandler,
  useRememberedClient,
} from "./client-context"

/**
 * The scope switcher's state and rules, apart from its markup: which client
 * and which location are in scope, where choosing another one goes, and the
 * toast that names the result. Shared by the desk switcher, the phone scope
 * sheet, the app-bar trigger and the command palette (`useClientSwitch`).
 */

/** Past this many rows a list gets a search field. */
export const SEARCH_THRESHOLD = 8

/**
 * The pages where a single `?locationId=` narrows the page to one location:
 * the Inbox and Reports. Listings has its own page per location instead.
 */
const LOCATION_SCOPED_PATHS = ["/inbox", "/reports"] as const

function isLocationScopedPath(pathname: string | null): boolean {
  return (LOCATION_SCOPED_PATHS as readonly string[]).includes(pathname ?? "")
}

/**
 * The one location the address narrows to, or null. The Inbox's
 * `?locationId=` is a comma list; only a single id is "a location in
 * scope". Two or more is a filter, not a scope.
 */
export function currentLocationFromAddress(
  pathname: string | null,
  search: URLSearchParams
): string | null {
  if (!isLocationScopedPath(pathname)) return null
  const raw = search.get("locationId")?.trim()
  if (!raw || raw.includes(",")) return null
  return raw
}

/**
 * Where choosing a location goes. On the Inbox and Reports: the same page,
 * narrowed to it (`?locationId=`), keeping the other parameters but not a
 * selected review, which belonged to the old scope. In agency mode the
 * location's client goes with it, so the client scope names the same client;
 * a business has no client scope, so a stale `?clientId=` is dropped.
 * Anywhere else: the location's listing. Null when it is already there.
 */
export function locationSwitchTarget(input: {
  pathname: string | null
  search: URLSearchParams
  location: Pick<DirectoryEntry, "id" | "clientId">
  mode: WorkspaceMode
}): { href: string; mode: "push" | "replace" } | null {
  const { pathname, location } = input
  if (isLocationScopedPath(pathname)) {
    const params = new URLSearchParams(input.search.toString())
    params.set("locationId", location.id)
    params.delete("selected")
    if (input.mode === "business") params.delete("clientId")
    else if (location.clientId) params.set("clientId", location.clientId)
    const query = params.toString()
    return { href: `${pathname}?${query}`, mode: "replace" }
  }
  const listing = `/listings/${encodeURIComponent(location.id)}`
  if (pathname === listing || pathname?.startsWith(`${listing}/`)) return null
  return { href: listing, mode: "push" }
}

/** `href` without its location narrowing or selected review. */
function withoutLocation(href: string): string {
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  params.delete("locationId")
  params.delete("selected")
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path!
}

/**
 * Widening a location scope back out (All locations, or All <client>
 * locations for the client already in scope): the same page without its
 * `?locationId=` or selected review. Null where there is nothing to widen.
 */
export function clearLocationTarget(input: {
  pathname: string | null
  search: URLSearchParams
}): string | null {
  const { pathname } = input
  if (!isLocationScopedPath(pathname) || !input.search.has("locationId"))
    return null
  const params = new URLSearchParams(input.search.toString())
  params.delete("locationId")
  params.delete("selected")
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname!
}

/** The toast's words: "Switched to Harbour Kitchen". */
export function switchedTitle(scopeName: string): string {
  return `Switched to ${scopeName}`
}

/**
 * Says what the operator is now working on. A local, already-applied change,
 * so no Undo and no type icon: one plain line, like any other confirmation
 * of where you are.
 */
export function announceSwitch(scopeName: string) {
  toast.add({ title: switchedTitle(scopeName) })
}

/** A location's name with its client: "The Bell · Harbour Kitchen". */
export function locationScopeName(
  location: Pick<DirectoryEntry, "name" | "clientName">,
  clientName?: string | null
): string {
  const owner = clientName ?? location.clientName ?? null
  return owner ? `${location.name} · ${owner}` : location.name
}

/**
 * What the directory already says about a location's Google link, in words,
 * or null when it says nothing worth a line. Never inferred: a member's
 * directory has no `verified`, so it never reads "Not verified".
 */
export function locationStatusWords(entry: DirectoryEntry): string | null {
  if (!entry.linked) return "Not linked"
  if (entry.verified === false) return "Not verified"
  return null
}

/**
 * The location directory as the shell has it cached, without fetching:
 * the dashboard layout hydrates it, and the sheet's location views own the
 * query (`useLocationDirectory`). Reading the cache keeps the app-bar
 * trigger free of a query of its own, and keeps it working (as "unknown")
 * where there is no query client at all.
 */
export function useCachedDirectory(): DirectoryEntry[] | null {
  const client = React.useContext(QueryClientContext)
  const subscribe = React.useCallback(
    (onChange: () => void) =>
      client ? client.getQueryCache().subscribe(onChange) : () => {},
    [client]
  )
  const read = React.useCallback(() => {
    if (!client) return undefined
    const role =
      client.getQueryData<SessionResponse>(queryKeys.session)?.session?.role ??
      null
    const management = role === "owner" || role === "admin"
    return client.getQueryData<DirectoryEntry[]>(
      management ? queryKeys.locationsManagement : queryKeys.locations
    )
  }, [client])
  return React.useSyncExternalStore(subscribe, read, read) ?? null
}

/**
 * The current client and the way to change it, for the switcher and the
 * command palette. `clients` is null while the list is unknown, and empty
 * or single when there is nothing to switch between.
 *
 * `select(next, onSwitched)` calls `onSwitched` only once the switch has
 * happened and changed something: not when a page or an editor's leave
 * prompt declines it, and not when `next` is already the client.
 */
export function useClientSwitch({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const clients = useClients({ enabled })
  const { remembered, setRemembered } = useRememberedClient()
  const pageClientId = usePageClientScope()
  const pageHandler = usePageScopeHandler()

  const items = clients.data?.items ?? null
  const visibleIds = React.useMemo(
    () => (items ? new Set(items.map((client) => client.id)) : null),
    [items]
  )
  const current = currentClientId({
    pathname,
    searchClientId: searchParams.get("clientId"),
    pageClientId,
    remembered,
    visibleIds,
  })

  const select = React.useCallback(
    async (next: string | null, onSwitched?: () => void) => {
      const changed = next !== current
      const done = () => {
        if (changed) onSwitched?.()
      }
      // The Inbox applies the change itself, behind its unsaved-reply
      // guard; a declined discard leaves everything as it was.
      const handler = pageHandler()
      if (clientPageKind(pathname) === "scoped" && handler) {
        if (await handler(next)) {
          setRemembered(next)
          done()
        }
        return
      }
      const switched = clientSwitchTarget({
        pathname,
        search: new URLSearchParams(searchParams.toString()),
        current,
        next,
      })
      // All clients widens all the way: a location narrowing belongs to the
      // client being left (clientSwitchTarget only drops it when another
      // client is chosen), so it goes too, or the page would stay narrowed
      // while the switcher says All clients.
      const target =
        switched && next === null && clientPageKind(pathname) === "scoped"
          ? { ...switched, href: withoutLocation(switched.href) }
          : switched
      if (!target) {
        setRemembered(next)
        done()
        return
      }
      // Leaving an editor with unsaved edits asks first; staying keeps the
      // client as it was.
      guardNavigation(() => {
        setRemembered(next)
        if (target.mode === "push") router.push(target.href)
        else router.replace(target.href, { scroll: false })
        done()
      })
    },
    [current, pageHandler, pathname, router, searchParams, setRemembered]
  )

  return { clients: items, current, select }
}

/**
 * The location in scope and the ways to change it. Every change goes
 * through `guardNavigation`, so an editor with unsaved edits asks first,
 * and `onSwitched` runs only when the change actually happens.
 */
export function useLocationSwitch(mode: WorkspaceMode) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const current = currentLocationFromAddress(
    pathname,
    new URLSearchParams(searchParams.toString())
  )

  const go = React.useCallback(
    (
      target: { href: string; mode: "push" | "replace" },
      onSwitched?: () => void
    ) => {
      guardNavigation(() => {
        if (target.mode === "push") router.push(target.href)
        else router.replace(target.href, { scroll: false })
        onSwitched?.()
      })
    },
    [router]
  )

  /** Narrow to (or open) one location. False when nothing would change. */
  const chooseLocation = React.useCallback(
    (
      location: Pick<DirectoryEntry, "id" | "clientId">,
      onSwitched?: () => void
    ): boolean => {
      if (location.id === current) return false
      const target = locationSwitchTarget({
        pathname,
        search: new URLSearchParams(searchParams.toString()),
        location,
        mode,
      })
      if (!target) return false
      // Narrowing the Inbox or Reports changes the scope, so the toast names
      // it. Anywhere else this opens the location's listing, which is a page
      // change rather than a scope change: the chip and the ticked row still
      // show the scope, so a "Switched to" toast would contradict them.
      go(target, target.mode === "replace" ? onSwitched : undefined)
      return true
    },
    [current, go, mode, pathname, searchParams]
  )

  /** Widen back out to every location. False when nothing would change. */
  const clearLocation = React.useCallback(
    (onSwitched?: () => void): boolean => {
      const href = clearLocationTarget({
        pathname,
        search: new URLSearchParams(searchParams.toString()),
      })
      if (!href) return false
      go({ href, mode: "replace" }, onSwitched)
      return true
    },
    [go, pathname, searchParams]
  )

  return { current, chooseLocation, clearLocation }
}

export type ScopeLabel = {
  mode: WorkspaceMode
  /** Whether there is anything to switch between. */
  visible: boolean
  /** The scope's name: a client, a location, or All clients / All locations. */
  label: string
  /** The scope's status in words (a client's health), never a colour alone. */
  healthWords: string | null
  /** The client in scope (agency mode only). */
  client: ClientSummary | null
  /** The single location the address narrows to, when the directory knows it. */
  location: DirectoryEntry | null
}

function useAgencyScopeLabel(enabled: boolean) {
  const { clients, current } = useClientSwitch({ enabled })
  const visible = Boolean(clients && clients.length > 1)
  const client = clients?.find((entry) => entry.id === current) ?? null
  return {
    visible,
    client,
    label: client ? client.name : "All clients",
    healthWords: client ? healthLabel(client.health) : null,
  }
}

/**
 * The scope as words, for anything that has to say what is in scope without
 * being the switcher: the app-bar trigger, the More sheet's "Working on"
 * row. Agency: the client (a location narrowing is reported in `location`,
 * the label stays the client's). Business: the location, or All locations;
 * visible when there is more than one location to choose from. A business
 * never queries clients.
 */
export function useScopeLabel(mode: WorkspaceMode): ScopeLabel {
  const agency = useAgencyScopeLabel(mode === "agency")
  const directory = useCachedDirectory()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const locationId = currentLocationFromAddress(
    pathname,
    new URLSearchParams(searchParams.toString())
  )
  const location =
    (locationId && directory?.find((entry) => entry.id === locationId)) || null

  if (mode === "business") {
    return {
      mode,
      visible: Boolean(directory && directory.length > 1),
      label: location ? location.name : "All locations",
      healthWords: location ? locationStatusWords(location) : null,
      client: null,
      location,
    }
  }
  return { mode, ...agency, location }
}

/**
 * The agency scope as words (the client), kept for the callers that only
 * know about clients: the phone More sheet's "Working on: <name>" row.
 */
export function useClientScopeLabel(): {
  visible: boolean
  client: ClientSummary | null
  label: string
  healthWords: string | null
} {
  return useAgencyScopeLabel(true)
}
