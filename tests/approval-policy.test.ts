import type { TransactionSql } from "postgres"
import { describe, expect, it, vi } from "vitest"

import type { RecheckResult } from "@/lib/server/authz/actor"
import {
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

  it("passes the stored security version through so an unverifiable one fails closed", async () => {
    const recheck = vi
      .fn()
      .mockResolvedValueOnce(allowed("member"))
      .mockResolvedValueOnce({
        ok: false,
        reason: "security_version_unverifiable",
      })
    await expect(
      recheckApprovedWork(
        scriptedSql({ policy: TWO_PERSON }).sql,
        work({ approverSecurityVersion: 7 }),
        recheck
      )
    ).resolves.toMatchObject({
      ok: false,
      reason: "security_version_unverifiable",
    })
    expect(recheck.mock.calls[1][1]).toMatchObject({ securityVersion: 7 })
  })
})
