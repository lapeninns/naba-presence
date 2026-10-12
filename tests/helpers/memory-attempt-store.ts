import type {
  AttemptRow,
  AttemptStore,
  GbpAttemptStatus,
} from "@/lib/server/gbp-write"

export type MemoryAttempt = {
  id: string
  key: string
  status: GbpAttemptStatus | string
  intent: Record<string, unknown>
  errorCode: string | null
  response: unknown
  responseHash: string | null
}

/**
 * An in-memory AttemptStore for unit tests of surfaces that run on
 * runGbpWrite. It has no `table`, so runGbpWrite records no operation
 * receipt; every settle is kept in `rows` for assertions.
 */
export function memoryAttemptStore() {
  const rows = new Map<string, MemoryAttempt>()
  let next = 0
  const rowOf = (row: MemoryAttempt): AttemptRow => ({
    id: row.id,
    status: row.status,
    rawStatus: row.status,
    startedAt: new Date(),
  })
  const store: AttemptStore = {
    async find(_sql, input) {
      const row = [...rows.values()].find((entry) => entry.key === input.key)
      return row ? rowOf(row) : null
    },
    async start(_sql, input) {
      if (input.existing) {
        const row = rows.get(input.existing.id)
        if (!row) return null
        row.status = "validating"
        return rowOf(row)
      }
      const row: MemoryAttempt = {
        id: `m${++next}`,
        key: input.key,
        status: "validating",
        intent: input.intent as Record<string, unknown>,
        errorCode: null,
        response: undefined,
        responseHash: null,
      }
      rows.set(row.id, row)
      return rowOf(row)
    },
    async markPublishing(_sql, input) {
      const row = rows.get(input.id)
      if (row) row.status = "publishing"
    },
    async settle(_sql, input) {
      const row = rows.get(input.id)
      if (!row) return false
      if (
        input.expectedStatus !== undefined &&
        row.status !== input.expectedStatus
      )
        return false
      row.status = input.status
      row.errorCode = input.errorCode
      row.response = input.response
      row.responseHash = input.responseHash ?? null
      return true
    },
  }
  return {
    store,
    rows,
    /** The only attempt row (tests write once). */
    only(): MemoryAttempt {
      const all = [...rows.values()]
      if (all.length !== 1)
        throw new Error(`expected one attempt, found ${all.length}`)
      return all[0]!
    },
    reset() {
      rows.clear()
    },
  }
}
