import { PGlite } from "@electric-sql/pglite"
import postgres from "postgres"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  grantsFor,
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
//      hasAssignments/grants row and counts the queries issued.
//   3. Real execution: the same rendered SQL runs against @electric-sql/pglite
//      with a minimal location_member/review schema, so the json_object_agg
//      batch query and the visibility predicate are proven against Postgres
//      semantics rather than a stub.

const LOCATION_A = "11111111-1111-4111-8111-111111111111"
const LOCATION_B = "22222222-2222-4222-8222-222222222222"
const LOCATION_C = "33333333-3333-4333-8333-333333333333"
const USER_ASSIGNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const USER_UNASSIGNED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "session-1",
    userId: USER_ASSIGNED,
    organisationId: "org-1",
    organisationName: "Org",
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
  hasAssignments: boolean
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
        if (!rendered.text.includes('as "hasAssignments"')) {
          throw new Error(`FakeSql: unexpected query -- ${rendered.text}`)
        }
        return Promise.resolve([
          { hasAssignments: script.hasAssignments, grants: script.grants },
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
    "is the has-assignments-or-assigned rule for %s, bound to the given column",
    (role) => {
      const fragment = visibilityPredicate(
        sql,
        { role, userId: USER_ASSIGNED },
        sql`r.location_id`
      )
      const { text, params } = render(fragment as unknown as QueryLike)

      expect(params).toEqual([USER_ASSIGNED, USER_ASSIGNED])
      expect(text).toBe(
        "( not exists ( select 1 from location_member visibility_lm " +
          "where visibility_lm.user_id = $1 ) " +
          "or exists ( select 1 from location_member visibility_lm " +
          "where visibility_lm.user_id = $2 " +
          "and visibility_lm.location_id = r.location_id ) )"
      )
    }
  )

  it("composes into a larger query as a nested fragment", () => {
    const query = sql`select 1 from review r where ${visibilityPredicate(
      sql,
      { role: "member", userId: USER_ASSIGNED },
      sql`r.location_id`
    )} and r.id = ${LOCATION_A}`
    const { text, params } = render(query as unknown as QueryLike)

    expect(text.startsWith("select 1 from review r where ( not exists")).toBe(
      true
    )
    expect(text.endsWith("and r.id = $3")).toBe(true)
    expect(params).toEqual([USER_ASSIGNED, USER_ASSIGNED, LOCATION_A])
  })
})

// --- 2. rule permutations ---------------------------------------------------

describe("grantsFor -- rule permutations (scripted sql)", () => {
  it("returns an empty map and issues no query for no ids", async () => {
    const { sql, calls } = fakeSql({ hasAssignments: true, grants: null })
    const grants = await grantsFor(sql, makeSession(), [])
    expect(grants.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it.each(["owner", "admin"] as const)(
    "%s: full grant for every id without touching the database",
    async (role) => {
      const { sql, calls } = fakeSql({ hasAssignments: true, grants: null })
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
      hasAssignments: true,
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
    "member with NO assignments sees everything and falls back to session.canPublish=%s",
    async (canPublish) => {
      const { sql } = fakeSql({ hasAssignments: false, grants: null })
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

  it("viewer: visibility follows assignments, never edits or publishes", async () => {
    const { sql } = fakeSql({
      hasAssignments: true,
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

  it("viewer with NO assignments sees everything but still cannot publish", async () => {
    const { sql } = fakeSql({ hasAssignments: false, grants: null })
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

// --- 3. real execution against PGlite --------------------------------------

describe("permissions against PGlite", () => {
  let db: PGlite
  let sql: TransactionSql

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
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
        ('${LOCATION_B}', '${USER_ASSIGNED}', false);
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

  it("grantsFor: unassigned member sees everything with the session fallback", async () => {
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
      visibleReviewIds({ role: "owner", userId: USER_UNASSIGNED })
    ).resolves.toEqual([LOCATION_A, LOCATION_B, LOCATION_C])
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
