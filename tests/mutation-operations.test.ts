import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { z } from "zod"

import { INTENT_HEADER } from "@/lib/contracts/mutation-operations"
import {
  attemptStore,
  idempotencyKey,
  runGbpWrite,
  type GbpWriteInput,
  type TenantTransaction,
} from "@/lib/server/gbp-write"
import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
import { ApiError } from "@/lib/server/http"
import {
  currentIntentId,
  failureOutcome,
  parseIntentHeader,
  requestScopedKeyPart,
  settleOperationsForAttempts,
  withMutationIntent,
} from "@/lib/server/mutation-operations"
import { route } from "@/lib/server/route"
import { requireSession } from "@/lib/server/session"

import { pgliteSql } from "./helpers/pglite-tx"

// The operation ledger (0067_mutation_operation.sql) through runGbpWrite on
// PGlite: the real migration over the slice of the schema it references, a
// generic attempt table, and fake providers that count their calls.

vi.mock("@/lib/server/session", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn((session: unknown) => session),
}))

const ORG = "00000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000002"
const LOCATION = "00000000-0000-4000-8000-000000000003"
const CONNECTION = "00000000-0000-4000-8000-000000000006"
const INTENT = "9b2f6a3e-4c1d-4e8f-9a7b-2c3d4e5f6a7b"
const OTHER_INTENT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0067_mutation_operation.sql"),
  "utf8"
)

const SCHEMA = `
  create role naba_app_runtime;
  create table schema_migration (version text primary key);
  create table organisation (id uuid primary key);
  create table app_user (id uuid primary key);
  create table location (id uuid primary key, organisation_id uuid not null);
  create table google_connection (
    id uuid primary key,
    organisation_id uuid not null,
    credential_generation integer not null default 1
  );
  create table write_attempt (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null,
    actor_user_id uuid,
    status text not null,
    idempotency_key text not null,
    provider_error_code text,
    started_at timestamptz not null default now(),
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
    created_at timestamptz not null default now()
  );
  insert into organisation values ('${ORG}');
  insert into app_user values ('${USER}');
  insert into location values ('${LOCATION}', '${ORG}');
  insert into google_connection values ('${CONNECTION}', '${ORG}', 4);
`

const store = attemptStore({
  table: "write_attempt",
  columns: { startedAt: "started_at" },
})

type Row = Record<string, unknown>
type Input = GbpWriteInput<
  { name: string },
  { hash: string },
  Record<string, unknown>
>

describe("mutation operation ledger", () => {
  let db: PGlite
  let withTenant: TenantTransaction
  let mutations: number

  const operations = async (): Promise<Row[]> =>
    (
      await db.query<Row>(
        "select * from mutation_operation order by created_at"
      )
    ).rows

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(SCHEMA)
    await db.exec(migration)
    withTenant = (organisationId, callback) =>
      db.transaction(async (tx) => {
        await tx.query(
          "select set_config('app.organisation_id', $1, true) as organisation",
          [organisationId]
        )
        return callback(pgliteSql(tx))
      })
  })

  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    mutations = 0
    await db.exec(
      "delete from mutation_operation; delete from write_attempt; delete from audit_log;"
    )
  })

  const base = (content: string, overrides: Partial<Input> = {}): Input => ({
    organisationId: ORG,
    actorUserId: USER,
    requestId: crypto.randomUUID(),
    store,
    key: idempotencyKey([ORG, LOCATION, "hours_publish", content]),
    intent: {},
    inProgress: { code: "in_progress", message: "in progress" },
    failureCode: "google_write_failed",
    operation: {
      surface: "hours",
      action: "publish",
      locationId: LOCATION,
      targetType: "location",
      targetRef: "locations/1",
      payloadHash: idempotencyKey([content]),
      expectedRevision: 7,
      googleConnectionId: CONNECTION,
    },
    mutate: async () => {
      mutations += 1
      return { name: "locations/1" }
    },
    onAmbiguous: "readback",
    readback: {
      read: async () => ({ hash: content }),
      verify: ({ readback }) => readback.hash === content,
    },
    ...overrides,
  })

  const run = (
    intentId: string | null,
    content: string,
    overrides: Partial<Input> = {}
  ) => runGbpWrite(base(content, { intentId, ...overrides }), { withTenant })

  it("records the intent before dispatch and settles it confirmed_applied", async () => {
    let seenDuringMutate: Row[] = []
    const result = await run(INTENT, "a", {
      mutate: async () => {
        mutations += 1
        seenDuringMutate = await operations()
        return { name: "locations/1" }
      },
    })
    expect(seenDuringMutate).toHaveLength(1)
    expect(seenDuringMutate[0]).toMatchObject({ state: "sent" })
    const [operation] = await operations()
    expect(operation).toMatchObject({
      intent_id: INTENT,
      organisation_id: ORG,
      actor_user_id: USER,
      surface: "hours",
      action: "publish",
      location_id: LOCATION,
      target_ref: "locations/1",
      expected_revision: "7",
      google_connection_id: CONNECTION,
      connection_generation: 4,
      attempt_table: "write_attempt",
      attempt_id: result.attemptId,
      state: "confirmed_applied",
      approval_ref: null,
      security_version: null,
    })
    expect(result.operationId).toBe(operation.id)
  })

  it("answers the same intent and payload from the receipt without calling the provider", async () => {
    const first = await run(INTENT, "a")
    // A different request id and even a different attempt key: the receipt,
    // not the attempt table, answers.
    const second = await run(INTENT, "a", {
      key: idempotencyKey(["moved"]),
    })
    expect(mutations).toBe(1)
    expect(second).toMatchObject({
      idempotent: true,
      attemptId: first.attemptId,
      status: "succeeded",
      operationId: first.operationId,
    })
    expect(await operations()).toHaveLength(1)
  })

  it("refuses the same intent with a different payload hash as 409 intent_conflict", async () => {
    await run(INTENT, "a")
    await expect(run(INTENT, "b")).rejects.toMatchObject({
      status: 409,
      code: "intent_conflict",
    })
    expect(mutations).toBe(1)
    const [operation] = await operations()
    expect(operation.state).toBe("confirmed_applied")
  })

  it("keeps the legacy behaviour when the request carries no intent", async () => {
    await run(null, "a")
    const again = await run(null, "a")
    expect(again).toMatchObject({ idempotent: true })
    expect(again.operationId).toBeUndefined()
    expect(await operations()).toHaveLength(0)
  })

  it("records nothing for a surface that does not describe itself", async () => {
    await run(INTENT, "a", { operation: undefined })
    expect(await operations()).toHaveLength(0)
  })

  it("replays a Google refusal as the same error, recorded rejected", async () => {
    const refusal = new ApiError(400, "INVALID_ARGUMENT", "Bad hours.")
    const fail = {
      mutate: async () => {
        mutations += 1
        throw refusal
      },
    }
    await expect(run(INTENT, "a", fail)).rejects.toBe(refusal)
    const [operation] = await operations()
    expect(operation).toMatchObject({
      state: "rejected",
      error_code: "INVALID_ARGUMENT",
    })
    await expect(run(INTENT, "a", fail)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_ARGUMENT",
      message: "Bad hours.",
      details: { operationId: operation.id, outcome: "rejected" },
    })
    expect(mutations).toBe(1)
  })

  it("never re-sends an uncertain intent", async () => {
    const ambiguous = {
      onAmbiguous: "fail" as const,
      mutate: async (): Promise<{ name: string }> => {
        mutations += 1
        throw new GoogleMutationAmbiguousError()
      },
    }
    await expect(run(INTENT, "a", ambiguous)).rejects.toBeInstanceOf(
      GoogleMutationAmbiguousError
    )
    const [operation] = await operations()
    expect(operation.state).toBe("uncertain")
    await expect(run(INTENT, "a", ambiguous)).rejects.toMatchObject({
      status: 502,
      code: "google_mutation_ambiguous",
    })
    expect(mutations).toBe(1)
  })

  it("records a write Google accepted without a readback as awaiting_confirmation", async () => {
    await run(INTENT, "a", { onAmbiguous: "fail", readback: undefined })
    const [operation] = await operations()
    expect(operation.state).toBe("awaiting_confirmation")
  })

  it("links a new intent to an attempt that already succeeded", async () => {
    await run(null, "a")
    const result = await run(OTHER_INTENT, "a")
    expect(mutations).toBe(1)
    expect(result).toMatchObject({ idempotent: true })
    const [operation] = await operations()
    expect(operation).toMatchObject({
      intent_id: OTHER_INTENT,
      attempt_id: result.attemptId,
      state: "confirmed_applied",
    })
  })

  it("takes the request's ambient intent, for the first described write only", async () => {
    await withMutationIntent(INTENT, async () => {
      await runGbpWrite(base("a"), { withTenant })
      await runGbpWrite(base("b"), { withTenant })
    })
    const rows = await operations()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      intent_id: INTENT,
      state: "confirmed_applied",
    })
    expect(mutations).toBe(2)
  })

  /**
   * An interrupted request under INTENT: its receipt is `sent` and linked to
   * an attempt row it left in flight (`publishing`, started `ageMs` ago).
   */
  const strand = async (
    options: { intentId?: string | null; ageMs?: number } = {}
  ) => {
    const {
      rows: [attempt],
    } = await db.query<{ id: string }>(
      `insert into write_attempt
         (organisation_id, actor_user_id, status, idempotency_key, started_at)
       values ($1, $2, 'publishing', $3, now() - ($4 || ' milliseconds')::interval)
       returning id::text as id`,
      [
        ORG,
        USER,
        idempotencyKey([ORG, LOCATION, "hours_publish", "a"]),
        String(options.ageMs ?? 0),
      ]
    )
    const intentId = options.intentId === undefined ? INTENT : options.intentId
    if (intentId) {
      await db.query(
        `insert into mutation_operation
           (organisation_id, intent_id, actor_user_id, surface, action,
            payload_hash, attempt_table, attempt_id, state)
         values ($1, $2, $3, 'hours', 'publish', $4, 'write_attempt', $5, 'sent')`,
        [ORG, intentId, USER, idempotencyKey(["a"]), attempt.id]
      )
    }
    return attempt.id
  }

  it("settles a receipt when a reaper settles its attempt, and a same-intent retry answers from it", async () => {
    const attemptId = await strand({ ageMs: 25 * 60 * 60 * 1000 })
    // What the retention cron does to a row stranded for a day.
    await withTenant(ORG, async (sql) => {
      await sql`
        update write_attempt set status = 'ambiguous',
          provider_error_code = 'attempt_interrupted', finished_at = now()
        where id = ${attemptId}
      `
      await settleOperationsForAttempts(sql, {
        attemptTable: "write_attempt",
        attemptIds: [attemptId],
        state: "uncertain",
        attemptStatus: "ambiguous",
        errorCode: "attempt_interrupted",
      })
    })
    const [operation] = await operations()
    expect(operation).toMatchObject({
      state: "uncertain",
      error_code: "attempt_interrupted",
    })
    await expect(run(INTENT, "a")).rejects.toMatchObject({
      status: 502,
      code: "attempt_interrupted",
    })
    expect(mutations).toBe(0)
  })

  it("answers from a linked attempt settled behind the receipt's back instead of re-arming it", async () => {
    const attemptId = await strand()
    // Settled without touching the receipt (a reaper predating the link).
    await db.query(
      "update write_attempt set status = 'ambiguous' where id = $1",
      [attemptId]
    )
    await expect(run(INTENT, "a")).rejects.toMatchObject({ status: 502 })
    expect(mutations).toBe(0)
    const [operation] = await operations()
    expect(operation).toMatchObject({
      state: "uncertain",
      attempt_id: attemptId,
    })
  })

  it("links a new intent to another request's in-flight attempt instead of leaving it unlinked", async () => {
    const attemptId = await strand({ intentId: null })
    await expect(run(OTHER_INTENT, "a")).rejects.toMatchObject({
      status: 409,
      code: "in_progress",
    })
    expect(mutations).toBe(0)
    const [operation] = await operations()
    expect(operation).toMatchObject({
      intent_id: OTHER_INTENT,
      attempt_id: attemptId,
      state: "sent",
    })
    // It settles with that row.
    await db.query(
      "update write_attempt set status = 'publishing', started_at = now() - interval '1 hour' where id = $1",
      [attemptId]
    )
    const recovered = await run(null, "a")
    expect(recovered).toMatchObject({ idempotent: true, attemptId })
    const [settled] = await operations()
    expect(settled.state).toBe("confirmed_applied")
  })

  it("refuses a second replay-surface request under an intent whose write is still in flight", async () => {
    await strand()
    await expect(
      run(INTENT, "a", { onExisting: "replay" })
    ).rejects.toMatchObject({ status: 409, code: "intent_in_progress" })
    expect(mutations).toBe(0)
  })

  it("replays an internal failure with the status the original request answered", async () => {
    const fail = {
      mutate: async (): Promise<{ name: string }> => {
        mutations += 1
        throw new Error("boom")
      },
    }
    await expect(run(INTENT, "a", fail)).rejects.toThrow("boom")
    const [operation] = await operations()
    expect(operation).toMatchObject({
      state: "failed",
      receipt: expect.objectContaining({ httpStatus: 500 }),
    })
    await expect(run(INTENT, "a", fail)).rejects.toMatchObject({
      status: 500,
      code: "google_write_failed",
    })
    expect(mutations).toBe(1)
  })

  it("keeps the attempt's raw status on a success receipt for replays", async () => {
    await run(INTENT, "a")
    const [operation] = await operations()
    expect(operation.receipt).toMatchObject({ rawStatus: "succeeded" })
  })

  it("hides one organisation's receipts from another through forced RLS", async () => {
    await run(INTENT, "a")
    const other = "00000000-0000-4000-8000-0000000000ff"
    const seen = await db.transaction(async (tx) => {
      await tx.query("set local role naba_app_runtime")
      await tx.query("select set_config('app.organisation_id', $1, true)", [
        other,
      ])
      return (await tx.query("select id from mutation_operation")).rows
    })
    expect(seen).toEqual([])
  })
})

describe("intent identity", () => {
  const request = (headers: Record<string, string>, method = "POST") =>
    new Request("http://localhost/api/x", { method, headers })

  it("parses the Idempotency-Key header as a lower-cased UUID", () => {
    expect(INTENT_HEADER).toBe("Idempotency-Key")
    expect(parseIntentHeader(request({}))).toBeNull()
    expect(
      parseIntentHeader(request({ [INTENT_HEADER]: INTENT.toUpperCase() }))
    ).toBe(INTENT)
    expect(() =>
      parseIntentHeader(request({ [INTENT_HEADER]: "retry-1" }))
    ).toThrow(
      expect.objectContaining({ status: 400, code: "invalid_intent_id" })
    )
  })

  it("scopes request-scoped keys to the intent when there is one", () => {
    expect(requestScopedKeyPart("req-1")).toBe("req-1")
    withMutationIntent(INTENT, () => {
      expect(requestScopedKeyPart("req-1")).toBe(`intent:${INTENT}`)
    })
  })

  it("classifies only Google's own 4xx refusals as rejected", () => {
    expect(
      failureOutcome("failed", new ApiError(400, "INVALID_ARGUMENT", "x"))
    ).toBe("rejected")
    expect(
      failureOutcome("failed", new ApiError(404, "google_api_error", "x"))
    ).toBe("rejected")
    expect(
      failureOutcome("failed", new ApiError(409, "hours_snapshot_stale", "x"))
    ).toBe("failed")
    expect(
      failureOutcome("failed", new ApiError(429, "google_rate_limited", "x"))
    ).toBe("failed")
    expect(
      failureOutcome(
        "failed",
        new ApiError(502, "google_readback_mismatch", "x")
      )
    ).toBe("failed")
    expect(failureOutcome("ambiguous", new Error("x"))).toBe("uncertain")
  })

  describe("route()", () => {
    const seen: { intentId: string | null; ambient: string | null }[] = []
    const handler = route({
      body: z.object({}).passthrough(),
      handler: ({ intentId }) => {
        seen.push({ intentId, ambient: currentIntentId() })
        return { ok: true }
      },
    })

    beforeEach(() => {
      seen.length = 0
      vi.mocked(requireSession).mockResolvedValue({
        sessionId: "s",
        userId: USER,
        organisationId: ORG,
        organisationName: "Org",
        workspaceMode: "business",
        displayName: "Owner",
        email: "owner@example.test",
        role: "owner",
        canPublish: true,
      } as Awaited<ReturnType<typeof requireSession>>)
    })

    it("exposes a valid intent as ctx.intentId and as the ambient intent", async () => {
      const response = await handler(
        request({
          [INTENT_HEADER]: INTENT,
          "content-type": "application/json",
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
      expect(seen).toEqual([{ intentId: INTENT, ambient: INTENT }])
    })

    it("falls back to no intent when the header is missing", async () => {
      await handler(request({}), { params: Promise.resolve({}) })
      expect(seen).toEqual([{ intentId: null, ambient: null }])
    })

    it("ignores the header on routes without a session", async () => {
      const webhook = route({
        auth: "public",
        handler: ({ intentId }) => {
          seen.push({ intentId, ambient: currentIntentId() })
          return { ok: true }
        },
      })
      const response = await webhook(
        request({ [INTENT_HEADER]: "delivery-42" }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
      expect(seen).toEqual([{ intentId: null, ambient: null }])
    })

    it("refuses a malformed intent before the handler runs", async () => {
      const response = await handler(request({ [INTENT_HEADER]: "nope" }), {
        params: Promise.resolve({}),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: "invalid_intent_id",
      })
      expect(seen).toEqual([])
    })
  })
})
