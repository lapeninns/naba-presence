import { PGlite } from "@electric-sql/pglite"
import type { TransactionSql } from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  attemptStore,
  GBP_ATTEMPT_STATUSES,
  idempotencyKey,
  loadLinkedLocation,
  providerErrorCode,
  requireGbpWrite,
  requirePublishGrant,
  runGbpWrite,
  type AttemptStore,
  type GbpWriteInput,
  type TenantTransaction,
} from "@/lib/server/gbp-write"
import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

// The write pipeline is exercised against a real Postgres (pglite) with the
// shape of an hours-style attempt table (validating/publishing vocabulary),
// a started-style table (media/place-action vocabulary) and audit_log, using
// fake providers. `pgliteSql` renders postgres.js tagged templates -- nested
// fragments, `sql(identifier)`, `sql(row)` insert/update helpers and
// `sql.json()` -- into text + parameters and runs them on pglite.

const ORG = "00000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000002"
const LOCATION = "00000000-0000-4000-8000-000000000003"
const UNLINKED = "00000000-0000-4000-8000-000000000004"
const EXTERNAL = "00000000-0000-4000-8000-000000000005"
const CONNECTION = "00000000-0000-4000-8000-000000000006"
const ACCOUNT = "00000000-0000-4000-8000-000000000007"

// --- postgres.js rendering over pglite ---------------------------------------

type QueryLike = { strings: readonly string[]; args: unknown[] }
type Helper =
  | { kind: "identifier"; name: string }
  | { kind: "list"; values: unknown[] }
  | { kind: "row"; row: Record<string, unknown> }
type JsonParam = { kind: "json"; value: unknown }
type Runner = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

const isTemplate = (value: unknown): value is TemplateStringsArray =>
  Array.isArray(value) && "raw" in value
const isQuery = (value: unknown): value is QueryLike =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as QueryLike).strings) &&
  Array.isArray((value as QueryLike).args)
const isHelper = (value: unknown): value is Helper =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  ["identifier", "list", "row"].includes(String((value as Helper).kind))
const isJson = (value: unknown): value is JsonParam =>
  typeof value === "object" &&
  value !== null &&
  (value as JsonParam).kind === "json"
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

function pushParam(params: unknown[], value: unknown): string {
  if (isJson(value)) {
    params.push(JSON.stringify(value.value))
    return `$${params.length}::jsonb`
  }
  params.push(value)
  return `$${params.length}`
}

function render(
  query: QueryLike,
  params: unknown[] = []
): { text: string; params: unknown[] } {
  let text = query.strings[0]
  for (let i = 1; i < query.strings.length; i += 1) {
    const arg = query.args[i - 1]
    if (isQuery(arg)) {
      text += render(arg, params).text
    } else if (isHelper(arg)) {
      if (arg.kind === "identifier") text += quote(arg.name)
      else if (arg.kind === "list") {
        text += `(${arg.values.map((value) => pushParam(params, value)).join(",")})`
      } else {
        const entries = Object.entries(arg.row)
        text += /\bset\s*$/i.test(text)
          ? entries
              .map(
                ([column, value]) =>
                  `${quote(column)} = ${pushParam(params, value)}`
              )
              .join(", ")
          : `(${entries.map(([column]) => quote(column)).join(",")}) values (${entries.map(([, value]) => pushParam(params, value)).join(",")})`
      }
    } else {
      text += pushParam(params, arg)
    }
    text += query.strings[i]
  }
  return { text: text.replace(/\s+/g, " ").trim(), params }
}

function pgliteSql(runner: Runner): TransactionSql {
  const fn = (first: unknown, ...rest: unknown[]) => {
    if (isTemplate(first)) {
      const query: QueryLike & { then: unknown } = {
        strings: first,
        args: rest,
        then<T>(
          onFulfilled: (rows: unknown[]) => T,
          onRejected?: (error: unknown) => T
        ) {
          const { text, params } = render(query)
          return runner
            .query(text, params)
            .then((result) => result.rows)
            .then(onFulfilled, onRejected)
        },
      }
      return query
    }
    if (typeof first === "string") return { kind: "identifier", name: first }
    if (Array.isArray(first)) return { kind: "list", values: first }
    return { kind: "row", row: first as Record<string, unknown> }
  }
  fn.json = (value: unknown): JsonParam => ({ kind: "json", value })
  return fn as unknown as TransactionSql
}

// --- fixtures ------------------------------------------------------------------

const SCHEMA = `
  create table write_attempt (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    location_id uuid,
    actor_user_id uuid,
    operation text not null default 'publish',
    status text not null check (status in ('validating','validated','publishing','succeeded','failed','ambiguous','stale')),
    idempotency_key text not null,
    intended_payload jsonb not null,
    provider_http_status integer,
    provider_error_code text,
    provider_response_hash text,
    validated_at timestamptz,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    unique (organisation_id, idempotency_key)
  );
  create table replay_attempt (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    actor_user_id uuid,
    operation text not null,
    status text not null check (status in ('started','succeeded','failed','ambiguous')),
    idempotency_key text not null,
    google_response jsonb,
    last_error_code text,
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    unique (organisation_id, idempotency_key)
  );
  create table audit_log (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    actor_user_id uuid,
    action text not null,
    subject_type text not null,
    subject_id text not null,
    request_id text,
    metadata jsonb not null,
    created_at timestamptz not null default now(),
    unique (organisation_id, request_id, action, subject_type, subject_id)
  );
  create table location (id uuid primary key, organisation_id uuid not null, name text not null, timezone text not null);
  create table external_location (
    id uuid primary key, google_connection_id uuid not null,
    google_account_name text not null, google_location_name text not null
  );
  create table location_link (location_id uuid not null, external_location_id uuid not null, is_active boolean not null);
  create table google_account (id uuid primary key, google_connection_id uuid not null, google_account_name text not null);
  create table location_member (user_id uuid not null, location_id uuid not null, can_publish boolean not null);
`

const hoursStyle = attemptStore({
  table: "write_attempt",
  columns: {
    httpStatus: "provider_http_status",
    responseHash: "provider_response_hash",
    validatedAt: "validated_at",
    startedAt: "started_at",
  },
})

const replayStyle = attemptStore({
  table: "replay_attempt",
  statuses: {
    validating: "started",
    validated: "started",
    publishing: "started",
  },
  columns: { errorCode: "last_error_code", response: "google_response" },
})

const session: Session = {
  sessionId: "session",
  userId: USER,
  organisationId: ORG,
  organisationName: "Org",
  displayName: "Owner",
  email: "owner@example.test",
  role: "owner",
  canPublish: true,
}

type Row = Record<string, unknown>

describe("gbp-write", () => {
  let db: PGlite
  let withTenant: TenantTransaction
  let calls: string[]

  const rows = async (table: string): Promise<Row[]> =>
    (await db.query<Row>(`select * from ${table} order by created_at, id`)).rows
  const audits = async (): Promise<Row[]> =>
    (await db.query<Row>("select * from audit_log")).rows

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(SCHEMA)
    await db.exec(`
      insert into location values ('${LOCATION}', '${ORG}', 'Linked', 'Europe/London'),
                                  ('${UNLINKED}', '${ORG}', 'Unlinked', 'Europe/London');
      insert into external_location values ('${EXTERNAL}', '${CONNECTION}', 'accounts/1', 'locations/1');
      insert into location_link values ('${LOCATION}', '${EXTERNAL}', true);
    `)
    withTenant = (organisationId, callback) =>
      db.transaction(async (tx) => {
        await tx.query("select $1::text as organisation", [organisationId])
        return callback(pgliteSql(tx))
      })
  })

  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    calls = []
    await db.exec(
      "delete from write_attempt; delete from replay_attempt; delete from audit_log;"
    )
  })

  const track =
    <T>(name: string, value: T) =>
    async () => {
      calls.push(name)
      return value
    }

  type Input = GbpWriteInput<
    { name: string },
    { hash: string },
    Record<string, unknown>
  >

  const base = (overrides: Partial<Input> = {}): Input => ({
    organisationId: ORG,
    actorUserId: USER,
    requestId: "req-1",
    store: hoursStyle,
    key: idempotencyKey([ORG, EXTERNAL, "hours_publish", "3"]),
    intent: {
      location_id: LOCATION,
      operation: "publish",
      intended_payload: (sql: TransactionSql) => sql.json({ regularHours: [] }),
    },
    inProgress: { code: "hours_publish_in_progress", message: "in progress" },
    failureCode: "google_hours_publish_failed",
    validate: track("validate", undefined),
    mutate: track("mutate", { name: "locations/1" }),
    onAmbiguous: "readback",
    readback: {
      read: async () => {
        calls.push("read")
        return { hash: "expected" }
      },
      verify: ({ readback }) => readback.hash === "expected",
      hash: (readback) => readback.hash,
    },
    audit: (ctx) => ({
      action: "hours.publish.succeeded",
      subjectType: "write_attempt",
      subjectId: ctx.attemptId,
      metadata: { locationId: LOCATION },
    }),
    ...overrides,
  })

  const run = (overrides: Partial<Input> = {}) =>
    runGbpWrite(base(overrides), { withTenant })

  it("exports the status vocabulary once", () => {
    expect([...GBP_ATTEMPT_STATUSES]).toEqual([
      "validating",
      "validated",
      "publishing",
      "succeeded",
      "failed",
      "ambiguous",
    ])
  })

  it("success path: validate, publish, readback, settle succeeded, onSuccess, audit", async () => {
    let onSuccessSeen: string | undefined
    const result = await run({
      onSuccess: async (sql, ctx) => {
        calls.push("onSuccess")
        onSuccessSeen = ctx.readbackHash
        await sql`select 1`
      },
    })
    expect(calls).toEqual(["validate", "mutate", "read", "onSuccess"])
    expect(result.idempotent).toBe(false)
    if (result.idempotent) throw new Error("unreachable")
    expect(result.response).toEqual({ name: "locations/1" })
    expect(result.readbackHash).toBe("expected")
    expect(onSuccessSeen).toBe("expected")

    const [row] = await rows("write_attempt")
    expect(row.status).toBe("succeeded")
    expect(row.provider_http_status).toBe(200)
    expect(row.provider_error_code).toBeNull()
    expect(row.provider_response_hash).toBe("expected")
    expect(row.actor_user_id).toBe(USER)
    expect(row.intended_payload).toEqual({ regularHours: [] })
    expect(row.validated_at).not.toBeNull()
    expect(row.finished_at).not.toBeNull()

    const [audit] = await audits()
    expect(audit.action).toBe("hours.publish.succeeded")
    expect(audit.subject_id).toBe(row.id)
    expect(audit.request_id).toBe("req-1")
    expect(audit.actor_user_id).toBe(USER)
  })

  it("an exact repeat of a successful attempt is idempotent and calls no provider", async () => {
    const first = await run()
    calls = []
    const second = await run({ requestId: "req-2" })
    expect(second).toEqual({
      idempotent: true,
      attemptId: first.attemptId,
      status: "succeeded",
      rawStatus: "succeeded",
    })
    expect(calls).toEqual([])
    expect(await rows("write_attempt")).toHaveLength(1)
  })

  it("an in-flight attempt for the same key is a 409 with the module's code", async () => {
    const key = base().key
    await db.query(
      "insert into write_attempt (organisation_id, status, idempotency_key, intended_payload) values ($1, 'publishing', $2, '{}')",
      [ORG, key]
    )
    await expect(run()).rejects.toMatchObject({
      status: 409,
      code: "hours_publish_in_progress",
    })
    expect(calls).toEqual([])
  })

  it("validateOnly failure settles failed (never ambiguous) and skips the provider call", async () => {
    await expect(
      run({
        validate: async () => {
          throw new GoogleMutationAmbiguousError()
        },
      })
    ).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
    expect(calls).toEqual([])
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("failed")
    expect(row.provider_error_code).toBe("google_mutation_ambiguous")
    expect(row.validated_at).toBeNull()
    expect(await audits()).toHaveLength(0)
  })

  it("a deterministic provider rejection settles failed with the error's code", async () => {
    await expect(
      run({
        mutate: async () => {
          throw new ApiError(400, "google_invalid_argument", "bad")
        },
      })
    ).rejects.toMatchObject({ code: "google_invalid_argument" })
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("failed")
    expect(row.provider_error_code).toBe("google_invalid_argument")
    expect(calls).toEqual(["validate"])
  })

  it("a codeless provider error records the module's fallback code", async () => {
    await expect(
      run({
        mutate: async () => {
          throw new Error("socket hang up")
        },
      })
    ).rejects.toThrow("socket hang up")
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("failed")
    expect(row.provider_error_code).toBe("google_hours_publish_failed")
  })

  it('onAmbiguous "fail": ambiguous provider error settles ambiguous, no readback, rethrows', async () => {
    await expect(
      run({
        onAmbiguous: "fail",
        mutate: async () => {
          throw new GoogleMutationAmbiguousError()
        },
      })
    ).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
    expect(calls).toEqual(["validate"])
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("ambiguous")
    expect(row.provider_error_code).toBe("google_mutation_ambiguous")
  })

  it('onAmbiguous "readback": a readback that verifies settles succeeded', async () => {
    const result = await run({
      mutate: async () => {
        calls.push("mutate")
        throw new GoogleMutationAmbiguousError()
      },
    })
    expect(calls).toEqual(["validate", "mutate", "read"])
    if (result.idempotent) throw new Error("unreachable")
    expect(result.providerAmbiguous).toBe(true)
    expect(result.response).toBeUndefined()
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("succeeded")
    expect(await audits()).toHaveLength(1)
  })

  it('onAmbiguous "readback": a readback that does not verify settles failed with the mismatch code', async () => {
    await expect(
      run({
        mutate: async () => {
          throw new GoogleMutationAmbiguousError()
        },
        readback: {
          read: async () => ({ hash: "other" }),
          verify: ({ readback }) => readback.hash === "expected",
          mismatch: {
            code: "google_readback_mismatch",
            message: "Google read-back did not match.",
          },
        },
      })
    ).rejects.toMatchObject({ status: 502, code: "google_readback_mismatch" })
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("failed")
    expect(row.provider_error_code).toBe("google_readback_mismatch")
  })

  it("a readback mismatch after a clean write is a 502 failed with the default code", async () => {
    await expect(
      run({
        readback: {
          read: async () => ({ hash: "other" }),
          verify: ({ readback }) => readback.hash === "expected",
        },
      })
    ).rejects.toMatchObject({ status: 502, code: "google_readback_mismatch" })
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("failed")
    expect(await audits()).toHaveLength(0)
  })

  it("a readback that cannot be read leaves the attempt ambiguous", async () => {
    await expect(
      run({
        readback: {
          read: async () => {
            throw new ApiError(503, "google_unavailable", "down")
          },
          verify: () => true,
        },
      })
    ).rejects.toMatchObject({ code: "google_unavailable" })
    const [row] = await rows("write_attempt")
    expect(row.status).toBe("ambiguous")
    expect(row.provider_error_code).toBe("google_unavailable")
  })

  it("a settled failure is re-armed in place on the next attempt", async () => {
    await expect(
      run({
        mutate: async () => {
          throw new ApiError(400, "google_invalid_argument", "bad")
        },
      })
    ).rejects.toBeTruthy()
    const [failed] = await rows("write_attempt")
    const result = await run({ requestId: "req-2" })
    expect(result.attemptId).toBe(failed.id)
    const all = await rows("write_attempt")
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe("succeeded")
    expect(all[0].provider_error_code).toBeNull()
  })

  it('retry "insert" writes a fresh row keyed by the request id', async () => {
    const insertStyle = attemptStore({
      table: "write_attempt",
      retry: "insert",
    })
    await expect(
      run({
        store: insertStyle,
        mutate: async () => {
          throw new ApiError(400, "google_invalid_argument", "bad")
        },
      })
    ).rejects.toBeTruthy()
    await run({ store: insertStyle, requestId: "req-2" })
    const all = await rows("write_attempt")
    expect(all.map((row) => row.status)).toEqual(["failed", "succeeded"])
    expect(all[1].idempotency_key).toBe(`${base().key}:req-2`)
  })

  it('a started-style table maps the vocabulary and "replay" returns any existing row', async () => {
    const replay = (overrides: Partial<Input> = {}) =>
      run({
        store: replayStyle,
        onExisting: "replay",
        intent: { operation: "create" },
        validate: undefined,
        onAmbiguous: "fail",
        readback: undefined,
        key: "loc:create:new:req-1",
        ...overrides,
      })
    await expect(
      replay({
        mutate: async () => {
          throw new ApiError(400, "google_invalid_argument", "bad")
        },
      })
    ).rejects.toBeTruthy()
    const [failed] = await rows("replay_attempt")
    expect(failed.status).toBe("failed")
    expect(failed.last_error_code).toBe("google_invalid_argument")

    calls = []
    const replayed = await replay()
    expect(replayed).toEqual({
      idempotent: true,
      attemptId: failed.id,
      status: "failed",
      rawStatus: "failed",
    })
    expect(calls).toEqual([])

    const fresh = await replay({
      key: "loc:create:new:req-2",
      requestId: "req-2",
    })
    if (fresh.idempotent) throw new Error("unreachable")
    const stored = (await rows("replay_attempt")).find(
      (row) => row.id === fresh.attemptId
    )
    expect(stored?.status).toBe("succeeded")
    expect(stored?.google_response).toEqual({ name: "locations/1" })
  })

  it("an in-flight started-style row reads back as in flight", async () => {
    await db.query(
      "insert into replay_attempt (organisation_id, operation, status, idempotency_key) values ($1, 'create', 'started', 'k')",
      [ORG]
    )
    const found = await withTenant(ORG, (sql) =>
      replayStyle.find(sql, { organisationId: ORG, key: "k" })
    )
    expect(found).toMatchObject({ status: "validating", rawStatus: "started" })
  })

  it("a hand-written AttemptStore works with the pipeline", async () => {
    const seen: string[] = []
    const store: AttemptStore<{ note: string }> = {
      async find() {
        seen.push("find")
        return null
      },
      async start(_sql, input) {
        seen.push(`start:${input.intent.note}`)
        return { id: "custom-1", status: "validating", rawStatus: "validating" }
      },
      async markPublishing(_sql, input) {
        seen.push(`publishing:${input.validated}`)
      },
      async settle(_sql, input) {
        seen.push(`settle:${input.status}`)
      },
    }
    const result = await runGbpWrite(
      {
        ...base(),
        store,
        intent: { note: "custom" },
        validate: undefined,
        audit: undefined,
      },
      { withTenant }
    )
    expect(result.attemptId).toBe("custom-1")
    expect(seen).toEqual([
      "find",
      "start:custom",
      "publishing:false",
      "settle:succeeded",
    ])
  })

  it("refuses resume mode without an inProgress error", async () => {
    await expect(run({ inProgress: undefined })).rejects.toThrow(/inProgress/)
  })
})

describe("idempotencyKey", () => {
  it("is stable across object key order and distinguishes different tuples", () => {
    const a = idempotencyKey([ORG, { revision: "3", hash: "h" }, ["a", "b"]])
    const b = idempotencyKey([ORG, { hash: "h", revision: "3" }, ["a", "b"]])
    const c = idempotencyKey([ORG, { hash: "h", revision: "4" }, ["a", "b"]])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it("treats undefined as null", () => {
    expect(idempotencyKey(["x", undefined])).toBe(idempotencyKey(["x", null]))
  })
})

describe("requireGbpWrite / requirePublishGrant", () => {
  const flags = {
    PUBLISH_ENABLED: true,
    GBP_PROFILE_WRITES_ENABLED: true,
    GBP_POSTS_ENABLED: false,
    GBP_MEDIA_ENABLED: true,
    GBP_PLACE_ACTIONS_ENABLED: true,
    GBP_FOOD_MENUS_ENABLED: true,
    GBP_PERFORMANCE_ENABLED: true,
    GBP_KEYWORDS_ENABLED: true,
  }

  it("passes when the surface is enabled", () => {
    expect(() =>
      requireGbpWrite(flags, "profileWrites", {
        code: "hours_publishing_disabled",
        message: "off",
      })
    ).not.toThrow()
  })

  it("throws the module's code (default 503) when the surface flag is off", () => {
    expect(() =>
      requireGbpWrite(flags, "posts", {
        code: "publishing_paused",
        message: "off",
      })
    ).toThrow(
      expect.objectContaining({ status: 503, code: "publishing_paused" })
    )
  })

  it("respects the global publish control and a custom status", () => {
    expect(() =>
      requireGbpWrite({ ...flags, PUBLISH_ENABLED: false }, "media", {
        status: 409,
        code: "hours_publishing_disabled",
        message: "off",
      })
    ).toThrow(
      expect.objectContaining({
        status: 409,
        code: "hours_publishing_disabled",
      })
    )
  })

  it("requirePublishGrant is a 403 with the module's code", () => {
    expect(() =>
      requirePublishGrant({ canPublish: true }, { code: "x", message: "x" })
    ).not.toThrow()
    expect(() =>
      requirePublishGrant(
        { canPublish: false },
        { code: "publish_permission_required", message: "no" }
      )
    ).toThrow(
      expect.objectContaining({
        status: 403,
        code: "publish_permission_required",
      })
    )
  })
})

describe("providerErrorCode", () => {
  it("prefers ApiError.code, then a string code property, then the fallback", () => {
    expect(providerErrorCode(new ApiError(400, "bad_request", "x"), "fb")).toBe(
      "bad_request"
    )
    expect(providerErrorCode({ code: "ECONNRESET" }, "fb")).toBe("ECONNRESET")
    expect(providerErrorCode({ code: 42 }, "fb")).toBe("fb")
    expect(providerErrorCode(new Error("x"), "fb")).toBe("fb")
  })
})

describe("loadLinkedLocation", () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(SCHEMA)
    await db.exec(`
      insert into location values ('${LOCATION}', '${ORG}', 'Linked', 'Europe/London'),
                                  ('${UNLINKED}', '${ORG}', 'Unlinked', 'Europe/London');
      insert into external_location values ('${EXTERNAL}', '${CONNECTION}', 'accounts/1', 'locations/1');
      insert into location_link values ('${LOCATION}', '${EXTERNAL}', true);
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  it("returns the superset context for a linked location", async () => {
    const linked = await loadLinkedLocation(pgliteSql(db), session, LOCATION)
    expect(linked).toMatchObject({
      organisationId: ORG,
      locationId: LOCATION,
      locationName: "Linked",
      timezone: "Europe/London",
      externalLocationId: EXTERNAL,
      googleConnectionId: CONNECTION,
      googleAccountName: "accounts/1",
      googleAccountId: null,
      googleLocationName: "locations/1",
      canPublish: true,
    })
    expect(typeof linked.accessToken).toBe("function")
  })

  it("resolves the google account id when the account row exists", async () => {
    await db.query("insert into google_account values ($1, $2, 'accounts/1')", [
      ACCOUNT,
      CONNECTION,
    ])
    const linked = await loadLinkedLocation(pgliteSql(db), session, LOCATION, {
      requireGoogleAccount: true,
    })
    expect(linked.googleAccountId).toBe(ACCOUNT)
    await db.query("delete from google_account")
  })

  it("raises the not-linked 409 with the default and a module-specific code", async () => {
    await expect(
      loadLinkedLocation(pgliteSql(db), session, UNLINKED)
    ).rejects.toMatchObject({
      status: 409,
      code: "google_location_not_linked",
    })
    await expect(
      loadLinkedLocation(pgliteSql(db), session, UNLINKED, {
        notLinked: { code: "location_not_linked", message: "Link first." },
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "location_not_linked",
      message: "Link first.",
    })
    await expect(
      loadLinkedLocation(pgliteSql(db), session, LOCATION, {
        requireGoogleAccount: true,
      })
    ).rejects.toMatchObject({ status: 409, code: "google_location_not_linked" })
  })

  it("raises 404 for a location that does not exist", async () => {
    await expect(
      loadLinkedLocation(
        pgliteSql(db),
        session,
        "00000000-0000-4000-8000-0000000000ff"
      )
    ).rejects.toMatchObject({ status: 404, code: "location_not_found" })
  })

  it("reports canPublish false for a viewer", async () => {
    const linked = await loadLinkedLocation(
      pgliteSql(db),
      { ...session, role: "viewer", canPublish: false },
      LOCATION
    )
    expect(linked.canPublish).toBe(false)
  })
})
