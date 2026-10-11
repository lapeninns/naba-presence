import { execFile } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  STUB_SERVICE_ROLE_KEY,
  STUB_TOTP_CODE,
  startAuthProviderStub,
} from "../helpers/auth-provider"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const PASSWORD = "Correct horse!42"
const MFA_CODES = new Set(["mfa_step_up_required", "mfa_enrollment_required"])
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

/**
 * P02-S9: owners and admins step up (a TOTP code from the last 15 minutes)
 * before sensitive actions; reads, enrollment and exports stay at aal1;
 * approvals record the assurance they were made with; operator recovery
 * (recover_user_mfa, scripts/mfa-recover.mjs) ends everything a person holds.
 */
describeDatabase("MFA step-up (P02-S9)", () => {
  let admin: ReturnType<typeof postgres>
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    auth = await startAuthProviderStub()
    google = await startGoogleStub()
    server = await startAppServer({
      PASSWORD_AUTH_ENABLED: "true",
      MFA_ENABLED: "true",
      SUPABASE_URL: auth.baseUrl,
      SUPABASE_PUBLISHABLE_KEY: "stub-publishable-key",
      GOOGLE_API_PROXY_BASE: google.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await auth.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  /**
   * An owner (or another role) whose app user is a provider identity in the
   * auth stub, optionally with a verified factor, signed in with an aal1
   * session (as every session from before 0200 is).
   */
  async function manager(
    options: {
      role?: "owner" | "admin" | "member" | "viewer"
      enrolled?: boolean
    } = {}
  ) {
    const tenant = await createTestTenant(admin, { role: options.role })
    organisations.push(tenant.organisationId)
    const subject = randomUUID()
    auth.addUser({ id: subject, email: tenant.email, password: PASSWORD })
    const enrolled = options.enrolled ?? true
    if (enrolled) auth.addFactor(tenant.email)
    await admin`
      update app_user
      set auth_provider = 'supabase',
          auth_subject = ${subject},
          mfa_factor_count = ${enrolled ? 1 : 0}
      where id = ${tenant.userId}
    `
    return { ...tenant, subject }
  }

  /** A session row with the given assurance; returns its cookie. */
  async function sessionWith(
    who: { userId: string; organisationId: string },
    assurance: { aal: "aal1" | "aal2"; verifiedMinutesAgo?: number }
  ) {
    const token = randomBytes(32).toString("base64url")
    const ago = assurance.verifiedMinutesAgo ?? 0
    await admin`
      insert into app_session (
        token_hash, user_id, organisation_id, expires_at,
        aal, mfa_factor_id, mfa_verified_at, mfa_proof_expires_at,
        security_version, auth_method
      )
      select
        ${sha256(token)}, ${who.userId}, ${who.organisationId},
        now() + interval '1 hour',
        ${assurance.aal},
        ${assurance.aal === "aal2" ? "factor-1" : null},
        ${assurance.aal === "aal2" ? admin`now() - ${ago}::integer * interval '1 minute'` : null},
        ${assurance.aal === "aal2" ? admin`now() - ${ago}::integer * interval '1 minute' + interval '15 minutes'` : null},
        u.security_version,
        'password'
      from app_user u where u.id = ${who.userId}
    `
    return `naba_session=${token}`
  }

  function send(
    method: string,
    path: string,
    cookie: string,
    body: unknown = {}
  ) {
    return fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    })
  }

  async function errorOf(response: Response): Promise<string | null> {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      return typeof parsed.error === "string" ? parsed.error : null
    } catch {
      return null
    }
  }

  async function stepUp(cookie: string, body: Record<string, unknown> = {}) {
    return send("POST", "/api/auth/mfa/step-up", cookie, {
      password: PASSWORD,
      code: STUB_TOTP_CODE,
      ...body,
    })
  }

  /**
   * Whether the cookie still resolves to a session. GET /api/session is
   * public: it answers 200 with `session: null` for an ended one.
   */
  async function signedIn(cookie: string): Promise<boolean> {
    const response = await send("GET", "/api/session", cookie)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { session: unknown }
    return body.session !== null
  }

  function sessionCookie(response: Response): string | null {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0] ?? ""
      if (pair.startsWith("naba_session=") && pair.length > 13) return pair
    }
    return null
  }

  const id = () => randomUUID()

  /** One handler of each sensitive kind (the full list is pinned statically). */
  const SENSITIVE: Array<[string, () => string, unknown?]> = [
    ["PATCH", () => "/api/settings"],
    ["PATCH", () => "/api/organisations"],
    ["POST", () => "/api/invitations"],
    ["PATCH", () => "/api/members"],
    ["DELETE", () => "/api/members"],
    ["PUT", () => `/api/members/${id()}/client-access`],
    ["POST", () => "/api/google/connect/start"],
    ["POST", () => `/api/google/connections/${id()}/disconnect`],
    ["PATCH", () => "/api/google/accounts"],
    ["POST", () => "/api/location-links"],
    ["POST", () => "/api/legal-holds"],
    ["POST", () => "/api/privacy/requests"],
    ["POST", () => `/api/reviews/${id()}/publish`],
    ["POST", () => `/api/reviews/${id()}/approval`],
    ["DELETE", () => `/api/reviews/${id()}/reply`],
    [
      "POST",
      () => "/api/reviews/bulk",
      {
        action: "approve",
        approvals: [
          {
            reviewId: id(),
            draftId: id(),
            reviewUpdateTime: "2026-10-01T10:00:00.000Z",
          },
        ],
      },
    ],
    ["POST", () => `/api/locations/${id()}/hours`],
    ["POST", () => `/api/locations/${id()}/posts/${id()}/publish`],
    ["POST", () => `/api/locations/${id()}/posts/${id()}/approval`],
    ["POST", () => `/api/locations/${id()}/change-requests/${id()}`],
    ["POST", () => `/api/locations/${id()}/post-schedules/${id()}/approve`],
    ["POST", () => `/api/listings/bulk/${id()}/approve`],
    ["POST", () => `/api/listings/bulk/${id()}/execute`],
  ]

  it("refuses an aal1 owner on every sensitive kind with mfa_step_up_required", async () => {
    const owner = await manager()
    const refused: string[] = []
    for (const [method, path, body] of SENSITIVE) {
      const response = await send(method, path(), owner.cookie, body)
      const code = await errorOf(response)
      if (response.status !== 403 || code !== "mfa_step_up_required") {
        refused.push(`${method} ${path()} -> ${response.status} ${code}`)
      }
    }
    expect(refused, refused.join("\n")).toEqual([])
  })

  it("lets an aal1 owner read, export and manage their own enrollment", async () => {
    const owner = await manager()
    for (const path of [
      "/api/session",
      "/api/settings",
      "/api/members",
      "/api/google/connections",
      "/api/auth/mfa/factors",
    ]) {
      const response = await send("GET", path, owner.cookie)
      expect(MFA_CODES.has((await errorOf(response)) ?? ""), path).toBe(false)
    }
    const exported = await send("POST", "/api/privacy/export", owner.cookie)
    expect(MFA_CODES.has((await errorOf(exported)) ?? "")).toBe(false)
    const enroll = await send("POST", "/api/auth/mfa/enroll", owner.cookie, {
      password: "wrong password",
    })
    expect(MFA_CODES.has((await errorOf(enroll)) ?? "")).toBe(false)
  })

  it("sends an unenrolled owner to enrollment", async () => {
    const owner = await manager({ enrolled: false })
    const response = await send("PATCH", "/api/settings", owner.cookie)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "mfa_enrollment_required",
      details: { enrollPath: "/settings/security" },
    })
    // Stepping up cannot stand in for enrolling.
    const stepped = await stepUp(owner.cookie)
    expect(stepped.status).toBe(403)
    expect(await errorOf(stepped)).toBe("mfa_enrollment_required")
  })

  it("refuses an aal2 proof older than 15 minutes and admits a fresh one", async () => {
    const owner = await manager()
    const stale = await sessionWith(owner, {
      aal: "aal2",
      verifiedMinutesAgo: 20,
    })
    const refused = await send("PATCH", "/api/settings", stale)
    expect(refused.status).toBe(403)
    expect(await errorOf(refused)).toBe("mfa_step_up_required")

    const fresh = await sessionWith(owner, {
      aal: "aal2",
      verifiedMinutesAgo: 2,
    })
    const admitted = await send("PATCH", "/api/settings", fresh)
    expect(MFA_CODES.has((await errorOf(admitted)) ?? "")).toBe(false)
  })

  it("does not hold members to it", async () => {
    const member = await manager({ role: "member", enrolled: false })
    const response = await send(
      "POST",
      `/api/reviews/${id()}/publish`,
      member.cookie,
      { draftId: id(), expectedReviewUpdateTime: "2026-10-01T10:00:00.000Z" }
    )
    expect(MFA_CODES.has((await errorOf(response)) ?? "")).toBe(false)
  })

  it("steps up with the password and a code, rotating the session to aal2", async () => {
    const owner = await manager()
    const wrongCode = await stepUp(owner.cookie, { code: "000000" })
    expect(wrongCode.status).toBe(400)
    expect(await errorOf(wrongCode)).toBe("mfa_code_invalid")
    const wrongPassword = await stepUp(owner.cookie, { password: "nope nope" })
    expect(wrongPassword.status).toBe(401)
    const noBackup = await stepUp(owner.cookie, { factor: "backup" })
    expect(noBackup.status).toBe(400)
    expect(await errorOf(noBackup)).toBe("mfa_factor_unknown")

    const stepped = await stepUp(owner.cookie)
    expect(stepped.status, await stepped.clone().text()).toBe(200)
    const body = (await stepped.json()) as { proofExpiresAt: string }
    const minutes = (Date.parse(body.proofExpiresAt) - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(14)
    expect(minutes).toBeLessThanOrEqual(15)
    const cookie = sessionCookie(stepped)
    expect(cookie).toBeTruthy()

    // The old aal1 session is gone; the new one is aal2 and passes.
    expect(await signedIn(owner.cookie)).toBe(false)
    const [row] = await admin<{ aal: string; mfaVerifiedAt: Date | null }[]>`
      select aal, mfa_verified_at as "mfaVerifiedAt"
      from app_session where token_hash = ${sha256(cookie!.slice(13))}
    `
    expect(row?.aal).toBe("aal2")
    expect(row?.mfaVerifiedAt).toBeTruthy()
    const admitted = await send("PATCH", "/api/settings", cookie!)
    expect(MFA_CODES.has((await errorOf(admitted)) ?? "")).toBe(false)
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::integer as count from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'user.mfa_step_up'
    `
    expect(audit?.count).toBe(1)
  })

  it("records the approver's assurance and the dispatch authorisation", async () => {
    google.reset()
    const owner = await manager()
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      review.reviewId,
      "Thank you for the lovely words about our garden."
    )
    // A member who cannot publish parks the reply for approval.
    const requester = await sessionForNewMember(owner.organisationId)
    const parked = await send(
      "POST",
      `/api/reviews/${review.reviewId}/publish`,
      requester,
      {
        draftId: draft.draftId,
        expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
      }
    )
    expect(parked.status, await parked.clone().text()).toBe(202)

    const atAal1 = await send(
      "POST",
      `/api/reviews/${review.reviewId}/approval`,
      owner.cookie,
      { decision: "approve" }
    )
    expect(atAal1.status).toBe(403)
    expect(await errorOf(atAal1)).toBe("mfa_step_up_required")

    const cookie = sessionCookie(await stepUp(owner.cookie))!
    const approved = await send(
      "POST",
      `/api/reviews/${review.reviewId}/approval`,
      cookie,
      { decision: "approve" }
    )
    expect(approved.status, await approved.clone().text()).toBe(200)
    const [decision] = await admin<
      {
        decidedBy: string
        aal: string | null
        verifiedAt: Date | null
        securityVersion: number | null
      }[]
    >`
      select
        decided_by::text as "decidedBy",
        authorised_aal as aal,
        authorised_mfa_verified_at as "verifiedAt",
        authorised_security_version as "securityVersion"
      from approval_decision
      where review_id = ${review.reviewId}
    `
    expect(decision).toMatchObject({
      decidedBy: owner.userId,
      aal: "aal2",
      securityVersion: 1,
    })
    expect(decision?.verifiedAt).toBeTruthy()
    const [attempt] = await admin<
      {
        authorisedBy: string | null
        aal: string | null
        securityVersion: number | null
        connectionId: string | null
      }[]
    >`
      select
        pa.authorised_by::text as "authorisedBy",
        pa.authorised_aal as aal,
        pa.authorised_security_version as "securityVersion",
        pa.authorised_connection_id::text as "connectionId"
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${review.reviewId}
    `
    expect(attempt).toEqual({
      authorisedBy: owner.userId,
      aal: "aal2",
      securityVersion: 1,
      connectionId: connection.connectionId,
    })
  })

  async function sessionForNewMember(organisationId: string) {
    const userId = randomUUID()
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (
        ${userId}, ${`harness-${userId.slice(0, 8)}@nabapresence.test`},
        'Requester', ${organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationId}, ${userId}, 'member', false)
    `
    return sessionWith({ userId, organisationId }, { aal: "aal1" })
  }

  describe("operator recovery", () => {
    it("bumps the version, ends every session, zeroes the factors and audits", async () => {
      const owner = await manager()
      const second = await sessionWith(owner, { aal: "aal2" })
      const [result] = await admin<
        { securityVersion: number; revoked: number; organisations: number }[]
      >`
        select
          security_version as "securityVersion",
          revoked_sessions as revoked,
          organisations
        from recover_user_mfa(${owner.userId}, 'ops@example.test', 'Lost phone, identity checked')
      `
      expect(result).toEqual({
        securityVersion: 2,
        revoked: 2,
        organisations: 1,
      })
      for (const cookie of [owner.cookie, second]) {
        expect(await signedIn(cookie)).toBe(false)
      }
      const [user] = await admin<{ factorCount: number }[]>`
        select mfa_factor_count as "factorCount" from app_user
        where id = ${owner.userId}
      `
      expect(user?.factorCount).toBe(0)
      const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit_log
        where organisation_id = ${owner.organisationId}
          and action = 'user.mfa_recovered'
      `
      expect(audit?.metadata).toMatchObject({
        operator: "ops@example.test",
        reason: "Lost phone, identity checked",
        securityVersion: 2,
        revokedSessions: 2,
      })
      // A session minted after recovery carries the new version and works;
      // the next sensitive action asks for enrollment afresh.
      const after = await sessionWith(owner, { aal: "aal1" })
      const refused = await send("PATCH", "/api/settings", after)
      expect(await errorOf(refused)).toBe("mfa_enrollment_required")
    })

    it("is not executable by the runtime role", async () => {
      const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, {
        max: 1,
      })
      try {
        await expect(
          runtime`select * from recover_user_mfa(${randomUUID()}, 'x', 'not allowed here')`
        ).rejects.toThrow(/permission denied/)
      } finally {
        await runtime.end()
      }
    })

    it("scripts/mfa-recover.mjs deletes the factors at the provider", async () => {
      const owner = await manager()
      auth.addFactor(owner.email)
      const exec = promisify(execFile)
      const env = {
        ...process.env,
        SUPABASE_URL: auth.baseUrl,
        SUPABASE_SERVICE_ROLE_KEY: STUB_SERVICE_ROLE_KEY,
      }
      const args = [
        "scripts/mfa-recover.mjs",
        "--email",
        owner.email,
        "--operator",
        "ops@example.test",
        "--reason",
        "Lost both phones, verified by call",
      ]
      const dry = await exec("node", [...args, "--dry-run"], { env })
      expect(dry.stdout).toContain("Provider factors: 2.")
      expect(dry.stdout).toContain("Dry run: nothing changed.")
      expect(auth.users.get(owner.email)?.factors).toHaveLength(2)

      const done = await exec("node", args, { env })
      expect(done.stdout).toContain("Deleted 2 provider factor(s); 0 left.")
      expect(auth.users.get(owner.email)?.factors).toHaveLength(0)
      expect(await signedIn(owner.cookie)).toBe(false)
      const [user] = await admin<{ securityVersion: number }[]>`
        select security_version as "securityVersion" from app_user
        where id = ${owner.userId}
      `
      expect(user?.securityVersion).toBe(2)
    })

    it("refuses to start without the service-role key", async () => {
      const owner = await manager()
      const exec = promisify(execFile)
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SUPABASE_URL: auth.baseUrl,
      }
      delete env.SUPABASE_SERVICE_ROLE_KEY
      await expect(
        exec(
          "node",
          [
            "scripts/mfa-recover.mjs",
            "--email",
            owner.email,
            "--operator",
            "ops@example.test",
            "--reason",
            "Lost phone, verified by call",
          ],
          { env }
        )
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY"),
      })
      const [user] = await admin<{ securityVersion: number }[]>`
        select security_version as "securityVersion" from app_user
        where id = ${owner.userId}
      `
      expect(user?.securityVersion).toBe(1)
    })
  })
})
