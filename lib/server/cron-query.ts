import "server-only"

/**
 * Query-string input for the Vercel Cron GET shims on the scheduler tick
 * routes (`/api/jobs/run`, `/api/sync/*`, `/api/cron/retention`).
 *
 * Vercel Cron fires HTTP GET with no body, while the scheduler POSTs a JSON
 * body validated by the zod schemas in `lib/contracts/sync`. The GET shims
 * accept the exact schema field names as query params
 * (`?maxOrganisations=100&organisationCursor=<uuid>`) and feed this object
 * to the same schema `parse`, so one page carries the same validation and
 * defaults as the POST body. Numeric strings coerce to numbers; anything
 * else stays a string so the schema rejects it with 400 `invalid_request`
 * instead of silently running with a default.
 *
 * Each cron fire runs one page from the head of the tenant order (or from
 * the `organisationCursor` it is given). Nothing here follows `nextCursor`:
 * cursor-walking across pages is the always-on scheduler's job, and these
 * shims exist because production has no scheduler process (see
 * `docs/runbook.md`).
 */
export function cronPageInput(
  searchParams: URLSearchParams
): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams
      .getAll(key)
      .filter((value) => value !== "")
      .map(coerceScalar)
    if (values.length === 0) continue
    input[key] = values.length === 1 ? values[0] : values
  }
  return input
}

function coerceScalar(value: string): unknown {
  if (value.trim() === "") return value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}
