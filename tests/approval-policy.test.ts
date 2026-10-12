import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { TransactionSql } from "postgres"
import { describe, expect, it, vi } from "vitest"

import type { RecheckResult } from "@/lib/server/authz/actor"
import {
  approvalSession,
  currentApprovalPolicy,
  currentManager,
  recheckApprovedWork,
  requireCurrentManager,
  requireSecondApprover,
  requireUnchangedTwoPersonPolicy,
  secondApproverSatisfied,
  type ApprovedWork,
} from "@/lib/server/authz/approval-policy"
import { ApiError } from "@/lib/server/http"
import type { GrantScope } from "@/lib/server/permissions"

// Billing enforcement on, for the worker session's access
// (approvalSession, through enforcementApplies).
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ BILLING_ENFORCEMENT_ENABLED: true }),
}))

// The shared approval-policy helper (P09-R2): current policy, current
// manager, the second-approver rule and the worker recheck used by reviewed
// change sets, bulk listing batches and the bulk runner.

const ORG = "99999999-9999-4999-8999-999999999999"
const LOCATION = "11111111-1111-4111-8111-111111111111"
const REQUESTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const APPROVER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const CONNECTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type Policy = { approvalRequired: boolean; requireTwoPersonApproval: boolean }

/** A scripted `sql` answering the organisation and member reads. */
function scriptedSql(script: {
  policy?: Policy | null
  member?: { role: GrantScope["role"]; canPublish: boolean } | null
  user?: { securityVersion: number } | null
}) {
  const queries: { text: string; values: unknown[] }[] = []
  const fn = (first: unknown, ...values: unknown[]) => {
    const text = (first as string[]).join("?")
    return {
      then(onFulfilled: (rows: unknown[]) => unknown) {
        queries.push({ text, values })
        let rows: unknown[]
        if (text.includes("from organisation"))
          rows = script.policy ? [script.policy] : []
        else if (text.includes("from member"))
          rows = script.member ? [script.member] : []
        else if (text.includes("from app_user"))
          rows = script.user ? [script.user] : []
        else throw new Error(`scriptedSql: unexpected query -- ${text}`)
        return Promise.resolve(rows).then(onFulfilled)
      },
    }
  }
  return { sql: fn as unknown as TransactionSql, queries }
}

const TWO_PERSON: Policy = {
  approvalRequired: true,
  requireTwoPersonApproval: true,
}
const ONE_PERSON: Policy = {
  approvalRequired: true,
  requireTwoPersonApproval: false,
}

async function apiError(promise: Promise<unknown> | (() => unknown)) {
  try {
    if (typeof promise === "function") promise()
    else await promise
  } catch (error) {
    if (error instanceof ApiError)
      return { status: error.status, code: error.code }
    throw error
  }
  throw new Error("expected an ApiError")
}

describe("approval policy -- current policy and manager", () => {
  it("reads this organisation's policy by id", async () => {
    const { sql, queries } = scriptedSql({ policy: TWO_PERSON })
    await expect(currentApprovalPolicy(sql, ORG)).resolves.toEqual(TWO_PERSON)
    expect(queries[0].values).toContain(ORG)
  })

  it("is a 404 when the organisation is gone", async () => {
    const { sql } = scriptedSql({ policy: null })
    await expect(apiError(currentApprovalPolicy(sql, ORG))).resolves.toEqual({
      status: 404,
      code: "organisation_not_found",
    })
  })

  it("answers a manager scope only for owners and admins", async () => {
    for (const role of ["owner", "admin"] as const) {
      const { sql, queries } = scriptedSql({
        member: { role, canPublish: false },
      })
      await expect(currentManager(sql, ORG, APPROVER)).resolves.toEqual({
        userId: APPROVER,
        role,
        canPublish: false,
      })
      // Membership is read for this organisation and this user, never by
      // user id alone.
      expect(queries[0].values).toEqual(expect.arrayContaining([ORG, APPROVER]))
    }
    for (const member of [
      { role: "member" as const, canPublish: true },
      { role: "viewer" as const, canPublish: true },
      null,
    ]) {
      const { sql } = scriptedSql({ member })
      await expect(currentManager(sql, ORG, APPROVER)).resolves.toBeNull()
      await expect(
        apiError(requireCurrentManager(sql, ORG, APPROVER))
      ).resolves.toEqual({
        status: 409,
        code: "approval_actor_access_changed",
      })
    }
  })
})

describe("approval policy -- the approver's security version (stream A)", () => {
  const admin = { role: "admin" as const, canPublish: true }

  it("keeps a manager whose version is the one their approval recorded", async () => {
    const { sql, queries } = scriptedSql({
      member: admin,
      user: { securityVersion: 3 },
    })
    await expect(currentManager(sql, ORG, APPROVER, 3)).resolves.toEqual({
      userId: APPROVER,
      role: "admin",
      canPublish: true,
    })
    expect(queries.some((query) => query.text.includes("from app_user"))).toBe(
      true
    )
  })

  it("refuses a manager recovered since the approval, or one with no account", async () => {
    for (const user of [{ securityVersion: 4 }, null]) {
      const { sql } = scriptedSql({ member: admin, user })
      await expect(currentManager(sql, ORG, APPROVER, 3)).resolves.toBeNull()
      await expect(
        apiError(
          requireCurrentManager(sql, ORG, APPROVER, { securityVersion: 3 })
        )
      ).resolves.toEqual({ status: 409, code: "approval_actor_access_changed" })
    }
  })

  it("does not compare an approval recorded before versions were (null)", async () => {
    const { sql, queries } = scriptedSql({ member: admin, user: null })
    await expect(
      currentManager(sql, ORG, APPROVER, null)
    ).resolves.not.toBeNull()
    expect(queries.some((query) => query.text.includes("from app_user"))).toBe(
      false
    )
  })

  it("answers with the caller's refusal code", async () => {
    const { sql } = scriptedSql({ member: null })
    await expect(
      apiError(
        requireCurrentManager(sql, ORG, APPROVER, {
          refusal: { code: "custom_refusal", message: "No." },
        })
      )
    ).resolves.toEqual({ status: 409, code: "custom_refusal" })
  })
})

describe("approval policy -- second approver", () => {
  it("only refuses the requester when two-person approval applies", () => {
    expect(secondApproverSatisfied(true, REQUESTER, REQUESTER)).toBe(false)
    expect(secondApproverSatisfied(true, REQUESTER, APPROVER)).toBe(true)
    expect(secondApproverSatisfied(false, REQUESTER, REQUESTER)).toBe(true)
  })

  it("throws second_approver_required for a self-approval", async () => {
    await expect(
      apiError(() => requireSecondApprover(true, REQUESTER, REQUESTER))
    ).resolves.toEqual({ status: 409, code: "second_approver_required" })
    expect(() => requireSecondApprover(true, REQUESTER, APPROVER)).not.toThrow()
  })

  it("refuses a decision once the frozen two-person flag moved", async () => {
    await expect(
      apiError(
        requireUnchangedTwoPersonPolicy(
          scriptedSql({ policy: TWO_PERSON }).sql,
          ORG,
          false
        )
      )
    ).resolves.toEqual({ status: 409, code: "approval_policy_changed" })
    // approval_required alone does not change what reviewed work needs.
    await expect(
      requireUnchangedTwoPersonPolicy(
        scriptedSql({
          policy: { approvalRequired: false, requireTwoPersonApproval: true },
        }).sql,
        ORG,
        true
      )
    ).resolves.toMatchObject({ requireTwoPersonApproval: true })
  })
})

describe("approval policy -- worker recheck", () => {
  const work = (extra: Partial<ApprovedWork> = {}): ApprovedWork => ({
    organisationId: ORG,
    locationId: LOCATION,
    requestedBy: REQUESTER,
    approvedBy: APPROVER,
    requireTwoPersonApproval: true,
    connectionId: CONNECTION,
    generation: 4,
    ...extra,
  })
  const allowed = (role: GrantScope["role"]): RecheckResult => ({
    ok: true,
    scope: { userId: APPROVER, role, canPublish: false },
    grant: { visible: true, canEdit: true, canPublish: true },
  })

  it("rechecks the requester and the approver with the frozen target", async () => {
    const recheck = vi.fn(async () => allowed("admin"))
    const result = await recheckApprovedWork(
      scriptedSql({ policy: TWO_PERSON }).sql,
      work({ approverSecurityVersion: null }),
      recheck
    )
    expect(result).toEqual({
      ok: true,
      approver: { userId: APPROVER, role: "admin", canPublish: false },
    })
    expect(recheck).toHaveBeenNthCalledWith(1, expect.anything(), {
      organisationId: ORG,
      actorUserId: REQUESTER,
      locationId: LOCATION,
      action: "request_approval",
    })
    expect(recheck).toHaveBeenNthCalledWith(2, expect.anything(), {
      organisationId: ORG,
      actorUserId: APPROVER,
      locationId: LOCATION,
      action: "publish",
      connectionId: CONNECTION,
      generation: 4,
      securityVersion: null,
    })
  })

  it("refuses work without a frozen connection and generation before any read", async () => {
    const recheck = vi.fn(async () => allowed("owner"))
    const { sql, queries } = scriptedSql({ policy: TWO_PERSON })
    for (const frozen of [{ connectionId: null }, { generation: null }]) {
      await expect(
        recheckApprovedWork(sql, work(frozen), recheck)
      ).resolves.toEqual({
        ok: false,
        reason: "connection_changed",
        subject: "approver",
      })
    }
    expect(queries).toHaveLength(0)
    expect(recheck).not.toHaveBeenCalled()
  })

  it("refuses when the two-person flag changed since the preview", async () => {
    const recheck = vi.fn(async () => allowed("owner"))
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: ONE_PERSON }).sql,
        work(),
        recheck
      )
    ).resolves.toEqual({
      ok: false,
      reason: "approval_policy_changed",
      subject: "policy",
    })
    expect(recheck).not.toHaveBeenCalled()
  })

  it("refuses a self-approval under two-person approval", async () => {
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: TWO_PERSON }).sql,
        work({ approvedBy: REQUESTER }),
        vi.fn(async () => allowed("owner"))
      )
    ).resolves.toEqual({
      ok: false,
      reason: "second_approver_required",
      subject: "policy",
    })
  })

  it("says whose right failed", async () => {
    const sql = scriptedSql({ policy: TWO_PERSON }).sql
    await expect(
      recheckApprovedWork(
        sql,
        work(),
        vi.fn(async () => ({ ok: false, reason: "actor_not_member" }) as const)
      )
    ).resolves.toEqual({
      ok: false,
      reason: "actor_not_member",
      subject: "requester",
    })
    const recheck = vi
      .fn()
      .mockResolvedValueOnce(allowed("member"))
      .mockResolvedValueOnce({ ok: false, reason: "generation_changed" })
    await expect(recheckApprovedWork(sql, work(), recheck)).resolves.toEqual({
      ok: false,
      reason: "generation_changed",
      subject: "approver",
    })
  })

  it("refuses an approver who may publish but is no longer an owner or admin", async () => {
    const recheck = vi
      .fn()
      .mockResolvedValueOnce(allowed("member"))
      .mockResolvedValueOnce(allowed("member"))
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: TWO_PERSON }).sql,
        work(),
        recheck
      )
    ).resolves.toEqual({
      ok: false,
      reason: "approver_not_manager",
      subject: "approver",
    })
  })

  it("passes the stored security version through, so a recovered approver is refused", async () => {
    const recheck = vi
      .fn()
      .mockResolvedValueOnce(allowed("member"))
      .mockResolvedValueOnce({
        ok: false,
        reason: "security_version_changed",
      })
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: TWO_PERSON }).sql,
        work({ approverSecurityVersion: 7 }),
        recheck
      )
    ).resolves.toEqual({
      ok: false,
      reason: "security_version_changed",
      subject: "approver",
    })
    expect(recheck.mock.calls[1][1]).toMatchObject({ securityVersion: 7 })
    // The requester's recheck never carries the approver's version.
    expect(recheck.mock.calls[0][1]).not.toHaveProperty("securityVersion")
  })

  it("passes a fully frozen policy (scheduled posts) to the approver's recheck only", async () => {
    const recheck = vi.fn().mockResolvedValue(allowed("owner"))
    const policy = { approvalRequired: true, requireTwoPersonApproval: true }
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: TWO_PERSON }).sql,
        work({ policy }),
        recheck
      )
    ).resolves.toMatchObject({ ok: true })
    expect(recheck.mock.calls[0][1]).not.toHaveProperty("policy")
    expect(recheck.mock.calls[1][1]).toMatchObject({ policy })
    // Without one, the recheck compares only what the work froze.
    recheck.mockClear()
    await recheckApprovedWork(
      scriptedSql({ policy: TWO_PERSON }).sql,
      work(),
      recheck
    )
    expect(recheck.mock.calls[1][1]).not.toHaveProperty("policy")
  })

  it("rechecks per-item work (bulk reviews) by its actions only", async () => {
    // One person decides a review batch; each review keeps its own approval
    // rules at publish, so the frozen flag, the second-approver rule and the
    // manager rule are not the recheck's to apply.
    const recheck = vi.fn(async () => allowed("member"))
    const result = await recheckApprovedWork(
      scriptedSql({ policy: TWO_PERSON }).sql,
      work({
        requestedBy: APPROVER,
        requireTwoPersonApproval: false,
        perItemApproval: true,
        requesterAction: "request_approval",
        approverAction: "request_approval",
      }),
      recheck
    )
    expect(result).toEqual({
      ok: true,
      approver: { userId: APPROVER, role: "member", canPublish: false },
    })
    expect((recheck.mock.calls as unknown[][])[1]?.[1]).toMatchObject({
      action: "request_approval",
      connectionId: CONNECTION,
      generation: 4,
    })
    // Their grants still count.
    const refused = vi.fn(async (): Promise<RecheckResult> => ({
      ok: false,
      reason: "action_denied",
    }))
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: TWO_PERSON }).sql,
        work({ requestedBy: APPROVER, perItemApproval: true }),
        refused
      )
    ).resolves.toEqual({
      ok: false,
      reason: "action_denied",
      subject: "requester",
    })
  })
})

describe("approval policy -- one implementation for every reviewed write", () => {
  const read = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8")

  it("is what change sets, bulk batches and scheduled posts decide with", () => {
    // Stream C's scheduled posts kept a minimal local check until stream D's
    // helper landed (INTEGRATION seam, merge-D); none of them may keep a
    // private copy of the manager or two-person rules now.
    for (const file of [
      "lib/server/gbp-change-sets.ts",
      "lib/server/bulk-listings.ts",
      "lib/server/publication-schedules.ts",
    ]) {
      const source = read(file)
      expect(source, file).toContain(
        'from "@/lib/server/authz/approval-policy"'
      )
      expect(source, file).not.toMatch(/async function requireCurrentManager/)
      expect(source, file).not.toMatch(/async function currentPolicy/)
    }
    for (const file of [
      "lib/server/bulk-listing-runner.ts",
      "lib/server/publication-schedule-runner.ts",
    ]) {
      const source = read(file)
      expect(source, file).toContain("recheckApprovedWork(")
      expect(source, file).not.toContain("INTEGRATION:")
      // The approver's recorded security version (stream A, 0106) reaches
      // the recheck.
      expect(source, file).toMatch(
        /approverSecurityVersion: (child|schedule)\.approvedSecurityVersion/
      )
    }
    expect(read("lib/server/authz/approval-policy.ts")).not.toContain(
      "INTEGRATION:"
    )
  })

  it("builds the worker session under the approval in one place", () => {
    // Both runners dispatch under the approver through approvalSession; a
    // private copy would drift (organisation name, billing access).
    for (const file of [
      "lib/server/bulk-listing-runner.ts",
      "lib/server/publication-schedule-runner.ts",
    ]) {
      const source = read(file)
      expect(source, file).toContain("approvalSession(sql, {")
      expect(source, file).not.toMatch(/from member m/)
      expect(source, file).not.toMatch(/organisationName: ""/)
    }
  })
})

describe("approval policy -- the worker session under an approval", () => {
  const SEEN_AT = new Date("2026-10-12T09:00:00.000Z")

  function sessionSql(member: Record<string, unknown> | null) {
    const queries: { text: string; values: unknown[] }[] = []
    const fn = (first: unknown, ...values: unknown[]) => {
      const text = (first as string[]).join("?")
      return {
        then(onFulfilled: (rows: unknown[]) => unknown) {
          queries.push({ text, values })
          let rows: unknown[]
          if (text.includes("from organisation_billing")) rows = []
          else if (text.includes("from member m")) rows = member ? [member] : []
          else throw new Error(`sessionSql: unexpected query -- ${text}`)
          return Promise.resolve(rows).then(onFulfilled)
        },
      }
    }
    return { sql: fn as unknown as TransactionSql, queries }
  }

  const input = {
    organisationId: ORG,
    approvedBy: APPROVER,
    sessionId: "bulk:op-1",
    approvedAal: "aal2" as const,
    approvedMfaVerifiedAt: SEEN_AT,
    approvedSecurityVersion: 3,
  }

  it("carries the approval's assurance, the real organisation name and the billing access", async () => {
    const { sql, queries } = sessionSql({
      role: "admin",
      canPublish: true,
      email: "approver@example.test",
      displayName: "Approver",
      organisationName: "The Old Crown",
      workspaceMode: "business",
    })
    const session = await approvalSession(sql, input, SEEN_AT)
    expect(session).toMatchObject({
      sessionId: "bulk:op-1",
      userId: APPROVER,
      organisationId: ORG,
      organisationName: "The Old Crown",
      role: "admin",
      canPublish: true,
      aal: "aal2",
      mfaVerifiedAt: SEEN_AT,
      securityVersion: 3,
      // No billing row reads as read-only, and enforcement applies to it.
      entitlementEnforced: true,
      access: expect.objectContaining({ canWrite: false }),
    })
    // The membership is read for this organisation and this approver.
    expect(queries[0].values).toEqual([ORG, APPROVER])
  })

  it("reads aal1 without a recorded assurance and returns null for a former member", async () => {
    const member = {
      role: "owner",
      canPublish: true,
      email: "a@example.test",
      displayName: "",
      organisationName: "Org",
      workspaceMode: "agency",
    }
    const session = await approvalSession(
      sessionSql(member).sql,
      {
        ...input,
        approvedAal: null,
        approvedMfaVerifiedAt: null,
        approvedSecurityVersion: null,
      },
      SEEN_AT
    )
    expect(session?.aal).toBe("aal1")
    expect(session?.securityVersion).toBeUndefined()
    await expect(
      approvalSession(sessionSql(null).sql, input, SEEN_AT)
    ).resolves.toBeNull()
  })
})
