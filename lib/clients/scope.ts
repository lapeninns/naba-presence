/**
 * The current client: which one client, if any, the operator is working.
 *
 * Agency staff work one client at a time, so the scope is shell context
 * rather than a per-page filter. Two things hold it:
 *
 * - The address, `?clientId=`, on the pages that filter by client (Inbox,
 *   the Listings board, Reports), and the path on a client's own pages
 *   (`/clients/<id>/…`). What a page shows always follows its address, so a
 *   scoped link can be shared and reloaded.
 * - A remembered preference, in a cookie (`CLIENT_SCOPE_COOKIE`), so the
 *   server-rendered sidebar links and the switcher agree on the first paint
 *   and the scope survives moving between pages and coming back tomorrow.
 *
 * The address wins. The preference only fills in when the operator ARRIVES on
 * a scoped page with no `?clientId=` of its own (a bookmark, the sign-in
 * redirect, a notification link), and it follows every change the address
 * makes, whichever control made it: the top-bar switcher, the Inbox filter
 * sheet, the board's client chips or the Reports client field. Removing the
 * scope on a page ("All clients") clears the preference too.
 *
 * Pure and client-safe: the shell, the switcher and the tests share it.
 */

/** Read by the dashboard layout; written by the shell. Not a secret. */
export const CLIENT_SCOPE_COOKIE = "np_client"

/** A year: the preference outlives a sign-out, like a theme choice. */
export const CLIENT_SCOPE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** The pages whose `?clientId=` IS the client scope. */
export const CLIENT_SCOPED_PATHS = ["/inbox", "/listings", "/reports"] as const

/**
 * An id the scope can hold. Deliberately a shape check, not a uuid parse: it
 * keeps garbage (and the board's `__unfiled__` pseudo-client) out of the
 * preference and out of the links built from it, and the API still decides
 * what a real id may see.
 */
export function isClientIdToken(
  value: string | null | undefined
): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value)
}

export type ClientPageKind =
  /** Inbox, Listings board, Reports: `?clientId=` is the scope. */
  | "scoped"
  /** `/clients/<id>/…`: the path is the scope. */
  | "client"
  /** `/listings/<id>/…`: the listing's client, when it has one. */
  | "listing"
  /** Team, Settings, Setup, the Clients index: no client of their own. */
  | "other"

const CLIENT_PATH = /^\/clients\/([^/]+)(\/.*)?$/
const LISTING_PATH = /^\/listings\/[^/]+(\/.*)?$/

export function clientPageKind(pathname: string | null): ClientPageKind {
  if (!pathname) return "other"
  if ((CLIENT_SCOPED_PATHS as readonly string[]).includes(pathname))
    return "scoped"
  const client = CLIENT_PATH.exec(pathname)
  if (client && client[1] !== "new") return "client"
  if (LISTING_PATH.test(pathname)) return "listing"
  return "other"
}

/** `/clients/<id>/settings` → `{ clientId, rest: "/settings" }`. */
export function clientFromPath(
  pathname: string | null
): { clientId: string; rest: string } | null {
  if (clientPageKind(pathname) !== "client") return null
  const match = CLIENT_PATH.exec(pathname!)!
  return { clientId: decodeURIComponent(match[1]), rest: match[2] ?? "" }
}

export type ClientScopeInput = {
  pathname: string | null
  /** The address's `?clientId=`, raw. */
  searchClientId: string | null
  /**
   * The client a page declared through `ClientScopeProvider`: a listing
   * page's client. Null elsewhere.
   */
  pageClientId: string | null
  /** The remembered preference. */
  remembered: string | null
  /** Every client this session can see; null while the list is unknown. */
  visibleIds: ReadonlySet<string> | null
}

/**
 * Which client the switcher shows for this page. Never an id the session
 * cannot see: a stale link or a removed grant reads as All clients.
 */
export function currentClientId(input: ClientScopeInput): string | null {
  const visible = (id: string | null): id is string =>
    id !== null && (input.visibleIds === null || input.visibleIds.has(id))
  const remembered = visible(input.remembered) ? input.remembered : null
  switch (clientPageKind(input.pathname)) {
    case "scoped":
      return isClientIdToken(input.searchClientId) &&
        visible(input.searchClientId)
        ? input.searchClientId
        : null
    case "client": {
      const id = clientFromPath(input.pathname)!.clientId
      return visible(id) ? id : null
    }
    case "listing":
      return visible(input.pageClientId) ? input.pageClientId : remembered
    case "other":
      return remembered
  }
}

export type ClientScopeSync = {
  /** The preference's new value; undefined leaves it alone. */
  remember?: string | null
  /**
   * The address's new `?clientId=`: an id to fill in, null to remove it;
   * undefined leaves the address alone.
   */
  searchClientId?: string | null
}

/**
 * What the shell does when the address or the client list changes: keep the
 * preference in step with the address, fill a remembered client into a
 * scoped page the operator arrived on unscoped, and drop a client the
 * session can no longer see.
 *
 * `previous` is the pathname and `?clientId=` the last call saw, or null on
 * the first. It is what tells arriving (fill in the remembered client) from
 * removing the scope on the page (forget it): both leave the address without
 * `?clientId=`, but only one of them happened on the same page.
 *
 * `narrowed` is true when the address already scopes to something smaller
 * than a client (`?locationId=`); filling in a client there could name a
 * different client from the one the location belongs to.
 *
 * Nothing is remembered while the session sees one client or none: there is
 * nothing to switch between, and a single-client Inbox should not grow a
 * "Client:" chip.
 */
export function syncClientScope(
  input: ClientScopeInput & {
    visibleIds: ReadonlySet<string>
    previous: { pathname: string | null; searchClientId: string | null } | null
    narrowed?: boolean
  }
): ClientScopeSync {
  const { visibleIds, remembered } = input
  const several = visibleIds.size > 1
  const rememberable = (id: string | null): id is string =>
    id !== null && several && visibleIds.has(id)
  const rememberedValid = rememberable(remembered) ? remembered : null
  // A remembered client that is gone (archived, access removed) or no longer
  // worth remembering is forgotten silently.
  const base: ClientScopeSync =
    remembered !== null && rememberedValid === null ? { remember: null } : {}
  const arrived =
    input.previous === null || input.previous.pathname !== input.pathname

  switch (clientPageKind(input.pathname)) {
    case "scoped": {
      const raw = input.searchClientId
      // The board's Unfiled chip and anything else that is not a client id:
      // the page's own business.
      if (raw !== null && !isClientIdToken(raw)) return base
      if (raw !== null) {
        if (!visibleIds.has(raw))
          return { remember: null, searchClientId: null }
        const changed = arrived || input.previous?.searchClientId !== raw
        if (!changed) return base
        return several ? (raw === remembered ? {} : { remember: raw }) : base
      }
      if (arrived) {
        return rememberedValid !== null && !input.narrowed
          ? { searchClientId: rememberedValid }
          : base
      }
      // Same page, and the scope went away: the operator chose All clients.
      if (input.previous?.searchClientId && remembered !== null)
        return { remember: null }
      return base
    }
    case "client": {
      const id = clientFromPath(input.pathname)!.clientId
      if (!rememberable(id)) return base
      return id === remembered ? {} : { remember: id }
    }
    case "listing": {
      const id = input.pageClientId
      if (!rememberable(id)) return base
      return id === remembered ? {} : { remember: id }
    }
    case "other":
      return base
  }
}

/**
 * Where choosing `next` in the switcher goes, or null when it only changes
 * the preference (Team, Settings, Setup) or changes nothing.
 *
 * - Inbox, Listings, Reports: the same page, `?clientId=` swapped, every
 *   other parameter kept except those that belong to one client (a location,
 *   a selected review). The Inbox narrows these itself; see
 *   `scopeInboxState`.
 * - A client's page: the same sub-page of the other client; All clients is
 *   the Clients index.
 * - A listing's page: the other client's hub (a listing belongs to one
 *   client, so there is no "same page" to go to); All clients is the board.
 */
export function clientSwitchTarget(input: {
  pathname: string | null
  search: URLSearchParams
  current: string | null
  next: string | null
}): { href: string; mode: "push" | "replace" } | null {
  const { pathname, next } = input
  if (next === input.current) return null
  switch (clientPageKind(pathname)) {
    case "scoped": {
      const params = new URLSearchParams(input.search.toString())
      if (next) params.set("clientId", next)
      else params.delete("clientId")
      if (next) {
        params.delete("locationId")
        params.delete("selected")
      }
      const query = params.toString()
      return {
        href: query ? `${pathname}?${query}` : pathname!,
        mode: "replace",
      }
    }
    case "client": {
      if (!next) return { href: "/clients", mode: "push" }
      const { rest } = clientFromPath(pathname)!
      return {
        href: `/clients/${encodeURIComponent(next)}${rest}`,
        mode: "push",
      }
    }
    case "listing":
      return next
        ? { href: `/clients/${encodeURIComponent(next)}`, mode: "push" }
        : { href: "/listings", mode: "push" }
    case "other":
      return null
  }
}

/**
 * A sidebar or palette link to a scoped page, carrying the remembered
 * client so moving between Inbox, Listings and Reports keeps the scope.
 */
export function withClientScope(href: string, clientId: string | null): string {
  if (!clientId || !(CLIENT_SCOPED_PATHS as readonly string[]).includes(href))
    return href
  return `${href}?clientId=${encodeURIComponent(clientId)}`
}

/** The cookie string that stores (or, with null, forgets) the preference. */
export function clientScopeCookie(clientId: string | null): string {
  return clientId
    ? `${CLIENT_SCOPE_COOKIE}=${encodeURIComponent(clientId)}; Path=/; Max-Age=${CLIENT_SCOPE_COOKIE_MAX_AGE}; SameSite=Lax`
    : `${CLIENT_SCOPE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

/** The cookie's value as the server read it, or null when unusable. */
export function parseClientScopeCookie(
  value: string | undefined
): string | null {
  if (!value) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  return isClientIdToken(decoded) ? decoded : null
}
