import { PGlite } from "@electric-sql/pglite"
import type { TransactionSql } from "postgres"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const env = vi.hoisted(() => ({ SCOPE_SHADOW_COMPARE: true }))
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))

const warn = vi.hoisted(() => vi.fn())
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn, error: vi.fn() },
}))

import {
  grantsFor,
  scopeShadowMismatches,
  type LocationGrant,
} from "@/lib/server/permissions"

// The explicit location scope (supabase 0063) is written beside the rows but
// read by nothing that decides a grant. grantsFor shadows it: the grants it
// returns are today's row-inferred ones, and any location where the explicit
// rule would answer differently is logged, never acted on.

// A `sql` that runs tagged-template queries against PGlite, rendering nested
// fragments and `sql(list)` builders the way postgres.js does (the same
// bridge as tests/permissions.test.ts).
type QueryLike = { strings: readonly string[]; args: unknown[] }

function isQueryLike(value: unknown): value is QueryLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as QueryLike).strings) &&
    Array.isArray((value as QueryLike).args)
  )
}

function render(query: QueryLike, params: unknown[] = []) {
  let text = query.strings[0]
  for (let i = 1; i < query.strings.length; i++) {
    const arg = query.args[i - 1]
    if (isQueryLike(arg)) {
      text += render(arg, params).text
    } else if (
      typeof arg === "object" &&
      arg !== null &&
      Array.isArray((arg as { first?: unknown }).first)
    ) {
      text += `(${(arg as { first: unknown[] }).first
        .map((value) => {
          params.push(value)
          return `$${params.length}`
        })
        .join(",")})`
    } else {
      params.push(arg)
      text += `$${params.length}`
    }
    text += query.strings[i]
  }
  return { text, params }
}

function pgliteSql(db: PGlite): TransactionSql {
  const fn = (first: unknown, ...args: unknown[]) => {
    if (Array.isArray(first) && "raw" in first) {
      const query = {
        strings: first as readonly string[],
        args,
        then<T>(
          onFulfilled: (rows: unknown[]) => T,
          onRejected?: (error: unknown) => T
        ) {
          const { text, params } = render(query)
          return db
            .query(text, params)
            .then((result) => result.rows)
            .then(onFulfilled, onRejected)
        },
      }
      return query
    }
    return { first }
  }
  return fn as unknown as TransactionSql
}

const LOCATION_A = "11111111-1111-4111-8111-111111111111"
const LOCATION_B = "22222222-2222-4222-8222-222222222222"
const CONSISTENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ALL_WITH_ROWS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ASSIGNED_NO_ROWS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

const grant = (visible: boolean, canPublish: boolean): LocationGrant => ({
  visible,
  canEdit: visible,
  canPublish,
})

describe("scopeShadowMismatches", () => {
  it("agrees with the row rule when the scope matches the rows", () => {
    expect(
      scopeShadowMismatches({
        role: "member",
        sessionCanPublish: true,
        locationScope: "assigned",
        assignedPublish: new Map([[LOCATION_A, true]]),
        current: new Map([
          [LOCATION_A, grant(true, true)],
          [LOCATION_B, grant(false, false)],
        ]),
      })
    ).toEqual([])
    expect(
      scopeShadowMismatches({
        role: "member",
        sessionCanPublish: false,
        locationScope: "all",
        assignedPublish: new Map(),
        current: new Map([[LOCATION_A, grant(true, false)]]),
      })
    ).toEqual([])
  })

  it("flags assigned-with-no-rows: today every location, explicitly none", () => {
    expect(
      scopeShadowMismatches({
        role: "viewer",
        sessionCanPublish: false,
        locationScope: "assigned",
        assignedPublish: new Map(),
        current: new Map([
          [LOCATION_A, grant(true, false)],
          [LOCATION_B, grant(true, false)],
        ]),
      })
    ).toEqual([LOCATION_A, LOCATION_B])
  })

  it("flags all-with-rows: today only the rows, explicitly everything", () => {
    expect(
      scopeShadowMismatches({
        role: "member",
        sessionCanPublish: false,
        locationScope: "all",
        assignedPublish: new Map([[LOCATION_A, true]]),
        current: new Map([
          // Publishes from the row today, from member.can_publish explicitly.
          [LOCATION_A, grant(true, true)],
          [LOCATION_B, grant(false, false)],
        ]),
      })
    ).toEqual([LOCATION_A, LOCATION_B])
  })
})

describe("grantsFor shadow compare against PGlite", () => {
  let db: PGlite
  let sql: TransactionSql

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create table member (
        user_id uuid primary key,
        location_scope text not null default 'all'
      );
      create table location_member (
        location_id uuid not null,
        user_id uuid not null,
        can_publish boolean not null default false,
        primary key (location_id, user_id)
      );
      insert into member (user_id, location_scope) values
        ('${CONSISTENT}', 'assigned'),
        ('${ALL_WITH_ROWS}', 'all'),
        ('${ASSIGNED_NO_ROWS}', 'assigned');
      insert into location_member (location_id, user_id, can_publish) values
        ('${LOCATION_A}', '${CONSISTENT}', true),
        ('${LOCATION_A}', '${ALL_WITH_ROWS}', true);
    `)
    sql = pgliteSql(db)
  })

  afterAll(async () => {
    await db.close()
  })

  beforeEach(() => {
    warn.mockClear()
    env.SCOPE_SHADOW_COMPARE = true
  })

  it("returns today's grants and logs nothing when the scope agrees", async () => {
    const grants = await grantsFor(
      sql,
      { role: "member", userId: CONSISTENT, canPublish: false },
      [LOCATION_A, LOCATION_B]
    )
    expect(grants.get(LOCATION_A)).toEqual(grant(true, true))
    expect(grants.get(LOCATION_B)).toEqual(grant(false, false))
    expect(warn).not.toHaveBeenCalled()
  })

  it("logs a disagreement without changing the grant", async () => {
    const grants = await grantsFor(
      sql,
      { role: "member", userId: ASSIGNED_NO_ROWS, canPublish: false },
      [LOCATION_A]
    )
    // Today's rule: no rows, so every location.
    expect(grants.get(LOCATION_A)).toEqual(grant(true, false))
    expect(warn).toHaveBeenCalledWith(
      "permissions.scope_shadow_mismatch",
      expect.objectContaining({
        userId: ASSIGNED_NO_ROWS,
        locationScope: "assigned",
        hasAssignments: false,
        mismatched: 1,
        sample: [LOCATION_A],
      })
    )
  })

  it("flags a member whose scope says all while rows exist", async () => {
    await grantsFor(
      sql,
      { role: "member", userId: ALL_WITH_ROWS, canPublish: false },
      [LOCATION_A, LOCATION_B]
    )
    expect(warn).toHaveBeenCalledWith(
      "permissions.scope_shadow_mismatch",
      expect.objectContaining({ locationScope: "all", mismatched: 2 })
    )
  })

  it("neither reads the scope nor logs when the flag is off", async () => {
    env.SCOPE_SHADOW_COMPARE = false
    const grants = await grantsFor(
      sql,
      { role: "member", userId: ASSIGNED_NO_ROWS, canPublish: false },
      [LOCATION_A]
    )
    expect(grants.get(LOCATION_A)).toEqual(grant(true, false))
    expect(warn).not.toHaveBeenCalled()
  })
})
