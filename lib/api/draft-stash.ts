import { draftIdentityPrefix, type DraftIdentity } from "@/lib/editors/draft-key"

const PREFIX = "naba:draft:"
const sources = new Map<string, () => string | null>()
// Set once the session that owns every registered draft has ended (a
// confirmed sign-out). From then on nothing may be written back to the
// stash: a late 401 or an unmount would otherwise re-stash the text that
// clearAllStashedDrafts just removed, for the next person on this tab.
// The full-page navigation that follows a sign-out resets it.
let abandoned = false

export function registerDraftSource(
  key: string,
  snapshot: () => string | null
): () => void {
  sources.set(key, snapshot)
  return () => {
    if (sources.get(key) === snapshot) sources.delete(key)
  }
}

export function stashAllDrafts(): void {
  if (abandoned) return
  for (const [key, snapshot] of sources) {
    // A misbehaving source's snapshot() must not abort the whole loop, and
    // callers (the 401 handler) must still redirect even if stashing a
    // draft fails - best-effort per source, so one bad source can't cost
    // every other source its stash or block the caller's next step.
    try {
      const value = snapshot()
      if (value !== null && value !== "") {
        sessionStorage.setItem(PREFIX + key, value)
      }
    } catch {
      // Skip this source; continue stashing the rest.
    }
  }
}

/**
 * Stashes one draft, best-effort. Used when a dirty editor is unmounted for
 * a reason the user never chose (a layout switch moving it to a new subtree)
 * so the next mount can `takeStashedDraft` it back.
 */
export function stashDraft(key: string, value: string): void {
  if (abandoned || value === "") return
  try {
    sessionStorage.setItem(PREFIX + key, value)
  } catch {
    // Storage full or unavailable: the draft is lost exactly as before.
  }
}

/**
 * Reads a stashed draft without removing it, for a render-time check (React
 * may run an initializer twice, so the read must not consume anything).
 * Null on the server or when storage is unavailable.
 */
export function peekStashedDraft(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return sessionStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function takeStashedDraft(key: string): string | null {
  const value = sessionStorage.getItem(PREFIX + key)
  if (value !== null) sessionStorage.removeItem(PREFIX + key)
  return value
}

/**
 * Removes every stashed draft from sessionStorage, best-effort. Called on a
 * confirmed sign-out: a stash outlives the session that wrote it, and the
 * next person to sign in on this tab must not be offered someone else's
 * unsent text.
 */
export function clearAllStashedDrafts(): void {
  if (typeof window === "undefined") return
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing could have been stashed either.
  }
}

/**
 * Removes every stashed draft that does not belong to `identity` (another
 * person, another organisation, or written before anyone was known),
 * best-effort. Called whenever the session's identity becomes known or
 * changes (lib/queries/scope-reset.ts): a stash outlives the session that
 * wrote it, and keys already keep it from being offered to anyone else, so
 * this is what stops it lingering in the tab. With no known identity there is
 * nothing to keep, but nothing is removed either: the session may simply not
 * have loaded yet.
 */
export function purgeForeignDrafts(identity: DraftIdentity): void {
  if (typeof window === "undefined") return
  if (!identity.userId || !identity.organisationId) return
  const own = PREFIX + draftIdentityPrefix(identity)
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(PREFIX) && !key.startsWith(own)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing could have been stashed either.
  }
}

/**
 * Gives up every registered draft for good: forgets the sources, refuses any
 * later stash, and tells dirty editors not to raise the browser's Leave
 * prompt (`draftsAbandoned`). Called on a confirmed sign-out before the
 * stash is cleared and the page navigates: answering "Stay" at a Leave
 * prompt would strand the person on a page whose session is gone, and the
 * next 401 there would stash their text again.
 */
export function abandonAllDrafts(): void {
  abandoned = true
  sources.clear()
}

/** Whether `abandonAllDrafts` has run in this page. */
export function draftsAbandoned(): boolean {
  return abandoned
}

/**
 * Test-only: clears every registered draft source. Not for production use —
 * intended for a top-level `beforeEach` so registrations from one test don't
 * leak into the next.
 */
export function __resetDraftSources(): void {
  sources.clear()
  abandoned = false
}
