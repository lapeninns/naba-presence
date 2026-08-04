// Pure — no "server-only", no "use client". Primary-location resolution runs
// server-side today, but the rule lives here as one implementation so that any
// future client-side consumer cannot disagree with the server about which
// business the user is looking at.

export type PrimaryCandidate = { id: string; name: string; linked: boolean }

/**
 * Total order over locations: linked first, then case-folded name, then id.
 *
 * The name comparison is a deliberate code-unit comparison, NOT
 * `localeCompare` and NOT the SQL `order by lower(name)` the directory query
 * uses for display. Postgres orders under an ICU collation and JavaScript
 * orders by UTF-16 code unit, and the two genuinely disagree — `Éclair` sorts
 * before `Zebra` in Postgres and after it in JS; `aa` before `a-b` in Postgres
 * and after it in JS. Any rule that read `rows[0]` on one side and sorted in
 * JS on the other would pick different businesses depending on the database's
 * locale. Sorting only here removes that surface entirely.
 *
 * `linked` is in the rule because unlinking leaves the `location` row behind
 * (DELETE /api/location-links only sets `is_active = false`): without it, an
 * owner who unlinks their alphabetically-first location would keep landing on
 * the dead one forever. `verified` is deliberately NOT in the rule — it flips
 * from Google-side state with no user action, and ranking on it would let the
 * app silently switch businesses overnight.
 */
export function comparePrimaryCandidates(
  a: PrimaryCandidate,
  b: PrimaryCandidate
): number {
  if (a.linked !== b.linked) return a.linked ? -1 : 1
  const an = a.name.toLowerCase()
  const bn = b.name.toLowerCase()
  if (an !== bn) return an < bn ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The single primary location for a directory, or null when there are none.
 *
 * A linear min-scan rather than `[...candidates].sort()[0]`: only the minimum
 * is needed, and it removes any chance of a later "optimisation" to an
 * in-place `.sort()` mutating the caller's array — which is usually the React
 * Query cache entry that also backs the /locations table's display order.
 */
export function pickPrimaryLocationId(
  candidates: readonly PrimaryCandidate[]
): string | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i += 1) {
    if (comparePrimaryCandidates(candidates[i], best) < 0) best = candidates[i]
  }
  return best.id
}
