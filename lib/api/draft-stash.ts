const PREFIX = "naba:draft:"
const sources = new Map<string, () => string | null>()

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

export function takeStashedDraft(key: string): string | null {
  const value = sessionStorage.getItem(PREFIX + key)
  if (value !== null) sessionStorage.removeItem(PREFIX + key)
  return value
}

/**
 * Test-only: clears every registered draft source. Not for production use —
 * intended for a top-level `beforeEach` so registrations from one test don't
 * leak into the next.
 */
export function __resetDraftSources(): void {
  sources.clear()
}
