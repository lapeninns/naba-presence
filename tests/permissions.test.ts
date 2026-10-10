import { PGlite } from "@electric-sql/pglite"
import postgres from "postgres"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  FULL_GRANT,
  grantsFor,
  memberGrant,
  NO_GRANT,
  publishPredicate,
  requireLocationAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

// lib/server/permissions.ts is the ONLY implementation of the location
// visibility / publish rule. These tests pin it down three ways:
//
//   1. Rendered SQL: a real postgres.js `sql` instance (never connected)
//      builds the fragments; `render` walks the Query/Builder tree the same
//      way postgres.js does at execution time so the text and parameter list
//      can be asserted.
//   2. Rule permutations: a scripted fake `sql` feeds grantsFor a known
//      locationScope/grants row and counts the queries issued.
//   3. Real execution: the same rendered SQL runs against @electric-sql/pglite
//      with a minimal member/location_member/review schema, so the json_object_agg
//      batch query and the visibility predicate are proven against Postgres
//      semantics rather than a stub.

const LOCATION_A = "11111111-1111-4111-8111-111111111111"
const LOCATION_B = "22222222-2222-4222-8222-222222222222"
const LOCATION_C = "33333333-3333-4333-8333-333333333333"
const USER_ASSIGNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const USER_UNASSIGNED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
// Scope 'assigned' with every row gone: the case that used to widen.
const USER_EMPTIED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
// No membership row at all.
const USER_STRANGER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
// Scope 'all' while holding a row: the rows are ignored.
const USER_ALL_WITH_ROWS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

// The tenant transaction's organisation, and another one the same user
// belongs to. The fixture has no RLS, like a connection that bypasses it.
const TENANT_ORG = "99999999-9999-4999-8999-999999999999"
const OTHER_ORG = "88888888-8888-4888-8888-888888888888"

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "session-1",
    userId: USER_ASSIGNED,
    organisationId: "org-1",
    organisationName: "Org",
    workspaceMode: "business",
    displayName: "Test User",
    email: "test@example.test",
    role: "member",
    canPublish: true,
    ...overrides,
  }
}

// --- postgres.js fragment rendering ---------------------------------------

type QueryLike = { strings: readonly string[]; args: unknown[] }
type BuilderLike = { first: unknown[] }

function isTaggedTemplateCall(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value
}

function isQueryLike(value: unknown): value is QueryLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as QueryLike).strings) &&
    Array.isArray((value as QueryLike).args)
  )
}

function isBuilderLike(value: unknown): value is BuilderLike {
  return (
    typeof value === "object" &&
    value !== null &&
    !isQueryLike(value) &&
    Array.isArray((value as BuilderLike).first)
  )
}

function render(
  query: QueryLike,
  params: unknown[] = []
): { text: string; params: unknown[] } {
  let text = query.strings[0]
  for (let i = 1; i < query.strings.length; i++) {
    const arg = query.args[i - 1]
    if (isQueryLike(arg)) {
      text += render(arg, params).text
    } else if (isBuilderLike(arg)) {
      // `location_id in ${sql(array)}` -> ($1,$2,...)
      text +=
        "(" +
        arg.first
          .map((value) => {
            params.push(value)
            return `$${params.length}`
          })
          .join(",") +
        ")"
    } else {
      params.push(arg)
      text += `$${params.length}`
    }
    text += query.strings[i]
  }
  return { text: text.replace(/\s+/g, " ").trim(), params }
}

// A `sql` that runs every tagged-template query against PGlite. Tagged calls
// return a lazy thenable (like postgres.js's Query) so the same object works
// both as a nested fragment and as an awaited query.
function pgliteSql(db: PGlite): TransactionSql {
  const fn = (first: unknown, ...args: unknown[]) => {
    if (isTaggedTemplateCall(first)) {
      const query = {
        strings: first,
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

// A scripted `sql` for rule permutations without a database.
type FakeScript = {
  locationScope: "all" | "assigned" | null
  grants: Record<string, boolean> | null
}

function fakeSql(script: FakeScript) {
  const calls: { text: string; params: unknown[] }[] = []
  const fn = (first: unknown, ...args: unknown[]) => {
    if (isTaggedTemplateCall(first)) {
      const query = { strings: first, args }
      const rendered = render(query)
      const execute = () => {
        calls.push(rendered)
        if (!rendered.text.includes('as "locationScope"')) {
          throw new Error(`FakeSql: unexpected query -- ${rendered.text}`)
        }
        return Promise.resolve([
          { locationScope: script.locationScope, grants: script.grants },
        ])
      }
      return {
        ...query,
        then: (onFulfilled: (rows: unknown[]) => unknown) =>
          execute().then(onFulfilled),
      }
    }
    return { first }
  }
  return { sql: fn as unknown as TransactionSql, calls }
}

// --- 1. rendered SQL ------------------------------------------------------

describe("visibilityPredicate", () => {
  // Never connects: fragments are built lazily and never awaited.
  const sql = postgres("postgres://unit-test@127.0.0.1:1/never", {
    max: 1,
    fetch_types: false,
  }) as unknown as TransactionSql

  afterAll(async () => {
    await (sql as unknown as postgres.Sql).end({ timeout: 0 })
  })

  it.each(["owner", "admin"] as const)(
    "is the constant `true` for %s",
    (role) => {
      const fragment = visibilityPredicate(
        sql,
        { role, userId: USER_ASSIGNED },
        sql`r.location_id`
      )
      expect(render(fragment as unknown as QueryLike)).toEqual({
        text: "true",
        params: [],
      })
    }
  )

  it.each(["member", "viewer"] as const)(
    "is the scope-all-or-assigned-row rule for %s, bound to the given column",
    (role) => {
      const fragment = visibilityPredicate(
        sql,
        { role, userId: USER_ASSIGNED },
        sql`r.location_id`
      )
      const { text, params } = render(fragment as unknown as QueryLike)

      expect(params).toEqual([USER_ASSIGNED, USER_ASSIGNED])
      expect(text).toBe(
        "( exists ( select 1 from member visibility_m " +
          "where visibility_m.user_id = $1 " +
          "and visibility_m.organisation_id = " +
          "nullif(current_setting('app.organisation_id', true), '')::uuid " +
          "and visibility_m.location_scope = 'all' ) " +
          "or exists ( select 1 from location_member visibility_lm " +
          "where visibility_lm.user_id = $2 " +
          "and visibility_lm.location_id = r.location_id ) )"
      )
      // Never the old "no rows means every location" rule.
      expect(text).not.toContain("not exists")
    }
  )

  it("composes into a larger query as a nested fragment", () => {
    const query = sql`select 1 from review r where ${visibilityPredicate(
      sql,
      { role: "member", userId: USER_ASSIGNED },
      sql`r.location_id`
    )} and r.id = ${LOCATION_A}`
    const { text, params } = render(query as unknown as QueryLike)

    expect(text.startsWith("select 1 from review r where ( exists")).toBe(
      true
    )
    expect(text.endsWith("and r.id = $3")).toBe(true)
    expect(params).toEqual([USER_ASSIGNED, USER_ASSIGNED, LOCATION_A])
  })
})

// --- 2. rule permutations ---------------------------------------------------

describe("grantsFor -- rule permutations (scripted sql)", () => {
  it("returns an empty map and issues no query for no ids", async () => {
    const { sql, calls } = fakeSql({ locationScope: "assigned", grants: null })
    const grants = await grantsFor(sql, makeSession(), [])
    expect(grants.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it.each(["owner", "admin"] as const)(
    "%s: full grant for every id without touching the database",
    async (role) => {
      const { sql, calls } = fakeSql({ locationScope: "assigned", grants: null })
      const grants = await grantsFor(sql, makeSession({ role }), [
        LOCATION_A,
        LOCATION_B,
      ])
      expect(calls).toHaveLength(0)
      expect(grants.get(LOCATION_A)).toEqual({
        visible: true,
        canEdit: true,
        canPublish: true,
      })
      expect(grants.get(LOCATION_B)).toEqual({
        visible: true,
        canEdit: true,
        canPublish: true,
      })
    }
  )

  it("member with assignments: exactly ONE query, dedupes ids, assigned/unassigned mixed", async () => {
    const { sql, calls } = fakeSql({
      locationScope: "assigned",
      grants: { [LOCATION_A]: true, [LOCATION_B]: false },
    })
    const grants = await grantsFor(sql, makeSession({ canPublish: true }), [
      LOCATION_A,
      LOCATION_B,
      LOCATION_C,
      LOCATION_A,
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual([
      USER_ASSIGNED,
      USER_ASSIGNED,
      LOCATION_A,
      LOCATION_B,
      LOCATION_C,
    ])
    expect(calls[0].text).toContain("lm.location_id in ($3,$4,$5)")
    expect(grants.size).toBe(3)
    expect(grants.get(LOCATION_A)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: true,
    })
    expect(grants.get(LOCATION_B)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
    // Assigned elsewhere, not here: hidden, and session.canPublish is NOT
    // consulted.
    expect(grants.get(LOCATION_C)).toEqual({
      visible: false,
      canEdit: false,
      canPublish: false,
    })
  })

  it.each([true, false])(
    "member on scope all sees everything and publishes per member.can_publish=%s",
    async (canPublish) => {
      const { sql } = fakeSql({ locationScope: "all", grants: null })
      const grants = await grantsFor(sql, makeSession({ canPublish }), [
        LOCATION_A,
      ])
      expect(grants.get(LOCATION_A)).toEqual({
        visible: true,
        canEdit: true,
        canPublish,
      })
    }
  )

  it("member with assignments: an upper-case id still matches its lower-case grant key", async () => {
    // Postgres renders uuid keys lower-case; z.uuid() accepts upper-case hex.
    // The SQL equality this replaced was case-insensitive, so the map is too.
    const { sql } = fakeSql({
      locationScope: "assigned",
      grants: { [LOCATION_A.toLowerCase()]: true },
    })
    const upper = LOCATION_A.toUpperCase()
    const grants = await grantsFor(sql, makeSession({ canPublish: false }), [
      upper,
    ])
    expect(grants.get(upper)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: true,
    })
  })

  it("viewer: visibility follows assignments, never edits or publishes", async () => {
    const { sql } = fakeSql({
      locationScope: "assigned",
      grants: { [LOCATION_A]: true },
    })
    const grants = await grantsFor(
      sql,
      makeSession({ role: "viewer", canPublish: true }),
      [LOCATION_A, LOCATION_B]
    )
    expect(grants.get(LOCATION_A)).toEqual({
      visible: true,
      canEdit: false,
      canPublish: false,
    })
    expect(grants.get(LOCATION_B)).toEqual({
      visible: false,
      canEdit: false,
      canPublish: false,
    })
  })

  it("viewer on scope all sees everything but still cannot publish", async () => {
    const { sql } = fakeSql({ locationScope: "all", grants: null })
    const grants = await grantsFor(
      sql,
      makeSession({ role: "viewer", canPublish: true }),
      [LOCATION_A]
    )
    expect(grants.get(LOCATION_A)).toEqual({
      visible: true,
      canEdit: false,
      canPublish: false,
    })
  })
})

describe("grantsFor -- explicit scope, never absence-means-all", () => {
  it.each(["member", "viewer"] as const)(
    "%s on scope assigned with ZERO rows sees nothing",
    async (role) => {
      const { sql } = fakeSql({ locationScope: "assigned", grants: null })
      const grants = await grantsFor(
        sql,
        makeSession({ role, canPublish: true }),
        [LOCATION_A, LOCATION_B]
      )
      expect(grants.get(LOCATION_A)).toEqual(NO_GRANT)
      expect(grants.get(LOCATION_B)).toEqual(NO_GRANT)
    }
  )

  it("no membership row (scope null) sees nothing", async () => {
    const { sql } = fakeSql({ locationScope: null, grants: null })
    const grants = await grantsFor(sql, makeSession({ canPublish: true }), [
      LOCATION_A,
    ])
    expect(grants.get(LOCATION_A)).toEqual(NO_GRANT)
  })

  it("scope all plus rows ignores the rows: visible everywhere, publish from member.can_publish", async () => {
    const { sql } = fakeSql({
      locationScope: "all",
      grants: { [LOCATION_A]: true },
    })
    const grants = await grantsFor(sql, makeSession({ canPublish: false }), [
      LOCATION_A,
      LOCATION_B,
    ])
    expect(grants.get(LOCATION_A)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
    expect(grants.get(LOCATION_B)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
  })
})

describe("memberGrant (pure rule)", () => {
  it.each([
    ["member", "all", null, true, { visible: true, canEdit: true, canPublish: true }],
    ["member", "all", false, true, { visible: true, canEdit: true, canPublish: true }],
    ["member", "assigned", true, false, { visible: true, canEdit: true, canPublish: true }],
    ["member", "assigned", false, true, { visible: true, canEdit: true, canPublish: false }],
    ["member", "assigned", null, true, NO_GRANT],
    ["member", null, null, true, NO_GRANT],
    ["viewer", "all", null, true, { visible: true, canEdit: false, canPublish: false }],
    ["viewer", "assigned", true, true, { visible: true, canEdit: false, canPublish: false }],
    ["viewer", "assigned", null, true, NO_GRANT],
    ["admin", "assigned", null, false, FULL_GRANT],
    ["owner", null, null, false, FULL_GRANT],
  ] as const)(
    "%s / scope %s / row %s / org publish %s",
    (role, locationScope, assignedPublish, sessionCanPublish, expected) => {
      expect(
        memberGrant({ role, locationScope, assignedPublish, sessionCanPublish })
      ).toEqual(expected)
    }
  )
})

// --- 3. real execution against PGlite --------------------------------------

describe("permissions against PGlite", () => {
  let db: PGlite
  let sql: TransactionSql

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create table member (
        organisation_id uuid not null default '${TENANT_ORG}',
        user_id uuid not null,
        location_scope text not null,
        primary key (organisation_id, user_id)
      );
      insert into member (user_id, location_scope) values
        ('${USER_ASSIGNED}', 'assigned'),
        ('${USER_UNASSIGNED}', 'all'),
        ('${USER_EMPTIED}', 'assigned'),
        ('${USER_ALL_WITH_ROWS}', 'all');
      -- What withTenant() sets; the member lookups filter on it.
      select set_config('app.organisation_id', '${TENANT_ORG}', false);
      create table location_member (
        location_id uuid not null,
        user_id uuid not null,
        can_publish boolean not null default false,
        primary key (location_id, user_id)
      );
      create table review (
        id uuid primary key,
        location_id uuid not null
      );
      insert into location_member (location_id, user_id, can_publish) values
        ('${LOCATION_A}', '${USER_ASSIGNED}', true),
        ('${LOCATION_B}', '${USER_ASSIGNED}', false),
        ('${LOCATION_A}', '${USER_ALL_WITH_ROWS}', false);
      insert into review (id, location_id) values
        ('${LOCATION_A}', '${LOCATION_A}'),
        ('${LOCATION_B}', '${LOCATION_B}'),
        ('${LOCATION_C}', '${LOCATION_C}');
    `)
    sql = pgliteSql(db)
  })

  afterAll(async () => {
    await db.close()
  })

  async function visibleReviewIds(session: Pick<Session, "role" | "userId">) {
    const rows = await sql<{ id: string }[]>`
      select r.id::text as id
      from review r
      where ${visibilityPredicate(sql, session, sql`r.location_id`)}
      order by r.id
    `
    return rows.map((row) => row.id)
  }

  it("grantsFor: assigned member gets per-location grants in one query", async () => {
    const grants = await grantsFor(sql, makeSession(), [
      LOCATION_A,
      LOCATION_B,
      LOCATION_C,
    ])
    expect(grants.get(LOCATION_A)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: true,
    })
    expect(grants.get(LOCATION_B)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
    expect(grants.get(LOCATION_C)).toEqual({
      visible: false,
      canEdit: false,
      canPublish: false,
    })
  })

  it("grantsFor: a member on scope all sees everything with member.can_publish", async () => {
    const session = makeSession({ userId: USER_UNASSIGNED, canPublish: false })
    const grants = await grantsFor(sql, session, [LOCATION_A, LOCATION_C])
    expect(grants.get(LOCATION_A)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
    expect(grants.get(LOCATION_C)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
  })

  it("visibilityPredicate filters rows to assigned locations", async () => {
    await expect(
      visibleReviewIds({ role: "member", userId: USER_ASSIGNED })
    ).resolves.toEqual([LOCATION_A, LOCATION_B])
    await expect(
      visibleReviewIds({ role: "viewer", userId: USER_ASSIGNED })
    ).resolves.toEqual([LOCATION_A, LOCATION_B])
    await expect(
      visibleReviewIds({ role: "member", userId: USER_UNASSIGNED })
    ).resolves.toEqual([LOCATION_A, LOCATION_B, LOCATION_C])
    await expect(
      visibleReviewIds({ role: "member", userId: USER_ALL_WITH_ROWS })
    ).resolves.toEqual([LOCATION_A, LOCATION_B, LOCATION_C])
    // Assigned with every row gone, and no membership at all: nothing.
    await expect(
      visibleReviewIds({ role: "member", userId: USER_EMPTIED })
    ).resolves.toEqual([])
    await expect(
      visibleReviewIds({ role: "viewer", userId: USER_STRANGER })
    ).resolves.toEqual([])
    await expect(
      visibleReviewIds({ role: "owner", userId: USER_UNASSIGNED })
    ).resolves.toEqual([LOCATION_A, LOCATION_B, LOCATION_C])
  })

  it("grantsFor: deleting an assigned member's last row yields no access, not every location", async () => {
    const userId = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    await db.exec(`
      insert into member (user_id, location_scope) values ('${userId}', 'assigned');
      insert into location_member (location_id, user_id, can_publish)
        values ('${LOCATION_C}', '${userId}', true);
    `)
    const session = makeSession({ userId, canPublish: true })
    const before = await grantsFor(sql, session, [LOCATION_A, LOCATION_C])
    expect(before.get(LOCATION_C)).toEqual(FULL_GRANT)
    expect(before.get(LOCATION_A)).toEqual(NO_GRANT)

    await db.exec(`delete from location_member where user_id = '${userId}'`)
    const after = await grantsFor(sql, session, [LOCATION_A, LOCATION_C])
    expect(after.get(LOCATION_A)).toEqual(NO_GRANT)
    expect(after.get(LOCATION_C)).toEqual(NO_GRANT)
    await expect(
      visibleReviewIds({ role: "member", userId })
    ).resolves.toEqual([])
  })

  it("scope from another organisation never widens this one, even without RLS", async () => {
    // 'all' elsewhere, 'assigned' with no rows here: nothing here. Without
    // the explicit organisation filter the 'all' row would match (and
    // grantsFor's scalar subquery would see two rows).
    const userId = "12121212-1212-4121-8121-121212121212"
    await db.exec(`
      insert into member (organisation_id, user_id, location_scope) values
        ('${OTHER_ORG}', '${userId}', 'all'),
        ('${TENANT_ORG}', '${userId}', 'assigned');
    `)
    const session = makeSession({ userId, canPublish: true })
    try {
      const grants = await grantsFor(sql, session, [LOCATION_A, LOCATION_C])
      expect(grants.get(LOCATION_A)).toEqual(NO_GRANT)
      expect(grants.get(LOCATION_C)).toEqual(NO_GRANT)
      await expect(
        visibleReviewIds({ role: "member", userId })
      ).resolves.toEqual([])

      // Read for the other organisation, the 'all' membership applies.
      await db.query("select set_config('app.organisation_id', $1, false)", [
        OTHER_ORG,
      ])
      await expect(
        visibleReviewIds({ role: "member", userId })
      ).resolves.toEqual([LOCATION_A, LOCATION_B, LOCATION_C])

      // Outside a tenant transaction no membership matches: fail closed.
      await db.query("select set_config('app.organisation_id', '', false)")
      await expect(
        visibleReviewIds({ role: "member", userId: USER_UNASSIGNED })
      ).resolves.toEqual([])
      expect(
        (await grantsFor(sql, session, [LOCATION_A])).get(LOCATION_A)
      ).toEqual(NO_GRANT)
    } finally {
      await db.query("select set_config('app.organisation_id', $1, false)", [
        TENANT_ORG,
      ])
    }
  })

  it("grantsFor: no membership row sees nothing", async () => {
    const grants = await grantsFor(
      sql,
      makeSession({ userId: USER_STRANGER, canPublish: true }),
      [LOCATION_A]
    )
    expect(grants.get(LOCATION_A)).toEqual(NO_GRANT)
  })

  it("publishPredicate agrees with grantsFor row by row", async () => {
    const cases = [
      makeSession({ userId: USER_ASSIGNED }),
      makeSession({ userId: USER_UNASSIGNED, canPublish: true }),
      makeSession({ userId: USER_UNASSIGNED, canPublish: false }),
      makeSession({ userId: USER_ALL_WITH_ROWS, canPublish: true }),
      makeSession({ userId: USER_EMPTIED, canPublish: true }),
      makeSession({ userId: USER_STRANGER, canPublish: true }),
      makeSession({ userId: USER_ASSIGNED, role: "viewer" }),
      makeSession({ userId: USER_EMPTIED, role: "admin" }),
    ]
    for (const session of cases) {
      const rows = await sql<{ id: string; publish: boolean }[]>`
        select r.id::text as id,
          ${publishPredicate(sql, session, sql`r.location_id`)} as publish
        from review r
        order by r.id
      `
      const grants = await grantsFor(
        sql,
        session,
        rows.map((row) => row.id)
      )
      for (const row of rows) {
        expect(
          { session: session.userId, role: session.role, id: row.id, publish: row.publish },
        ).toEqual({
          session: session.userId,
          role: session.role,
          id: row.id,
          publish: grants.get(row.id)!.canPublish,
        })
      }
    }
  })

  it("requireLocationAccess / canPublishLocation are thin wrappers over the same grant", async () => {
    const session = makeSession()
    await expect(
      requireLocationAccess(sql, session, LOCATION_A)
    ).resolves.toBeUndefined()
    await expect(
      requireLocationAccess(sql, session, LOCATION_C)
    ).rejects.toMatchObject({ status: 404, code: "review_not_found" })
    await expect(
      requireLocationAccess(sql, session, LOCATION_C)
    ).rejects.toBeInstanceOf(ApiError)

    await expect(canPublishLocation(sql, session, LOCATION_A)).resolves.toBe(
      true
    )
    await expect(canPublishLocation(sql, session, LOCATION_B)).resolves.toBe(
      false
    )
    await expect(canPublishLocation(sql, session, LOCATION_C)).resolves.toBe(
      false
    )
    await expect(
      canPublishLocation(sql, makeSession({ role: "viewer" }), LOCATION_A)
    ).resolves.toBe(false)
    await expect(
      canPublishLocation(sql, makeSession({ role: "admin" }), LOCATION_C)
    ).resolves.toBe(true)
  })

  it("requireLocationAccess lets the caller supply the 404 code and message", async () => {
    const session = makeSession()
    await expect(
      requireLocationAccess(sql, session, LOCATION_C, {
        code: "location_not_found",
        message: "The requested location was not found.",
      })
    ).rejects.toMatchObject({
      status: 404,
      code: "location_not_found",
      message: "The requested location was not found.",
    })
    // Partial overrides fall back field by field to the legacy review 404.
    await expect(
      requireLocationAccess(sql, session, LOCATION_C, {
        code: "location_not_found",
      })
    ).rejects.toMatchObject({
      code: "location_not_found",
      message: "The requested review was not found.",
    })
    await expect(
      requireLocationAccess(sql, session, LOCATION_C, {})
    ).rejects.toMatchObject({ code: "review_not_found" })
    // A visible location never throws, whatever the override.
    await expect(
      requireLocationAccess(sql, session, LOCATION_A, {
        code: "location_not_found",
      })
    ).resolves.toBeUndefined()
  })
})
