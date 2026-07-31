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
    const value = snapshot()
    if (value !== null && value !== "") {
      sessionStorage.setItem(PREFIX + key, value)
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
