import { beforeEach, describe, expect, it, vi } from "vitest"

import { writeAudit } from "@/lib/server/audit"
import {
  auditExtendedGrants,
  extendClientHolders,
  grantClientListings,
} from "@/lib/server/client-access"
import { getDatabase } from "@/lib/server/db"
import { acceptInvitationForSessionUser } from "@/lib/server/provisioning"

vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/server/session-store", () => ({
  createSession: vi.fn(async () => "new-session-token"),
}))

const ORG = "00000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-0000000000b1"
const INVITE = "00000000-0000-4000-8000-0000000000e1"
const CROWN = "00000000-0000-4000-8000-00000000c001"

type Pending = {
  role: string
  canPublish: boolean
  clientIds: string[] | null
}

/**
 * A fake acceptance transaction. `joined` controls whether the member insert
 * created a row; `granted` is what the location_member insert returns.
 */
function fakeAcceptance(input: {
  pending: Pending
  joined?: boolean
  granted?: string[]
}) {
  const statements: { text: string; values: unknown[] }[] = []
  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?")
      statements.push({ text, values })
      if (text.includes("from invitation")) {
        return Promise.resolve([
          {
            id: INVITE,
            email: "ben@example.test",
            expiresAt: new Date(Date.now() + 60_000),
            acceptedAt: null,
            ...input.pending,
          },
        ])
      }
      if (text.includes("insert into member")) {
        return Promise.resolve(
          input.joined === false ? [] : [{ user_id: USER }]
        )
      }
      if (text.includes("insert into location_member")) {
        return Promise.resolve(
          (input.granted ?? []).map((locationId) => ({ locationId }))
        )
      }
      return Promise.resolve([])
    }),
    { array: (values: unknown[]) => ({ array: values }) }
  )
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async (fn: (sql: unknown) => unknown) => fn(sql)),
  } as never)
  return statements
}

function accept(pending: Pending) {
  return acceptInvitationForSessionUser(
    { userId: USER, email: "ben@example.test" },
    {
      id: INVITE,
      organisationId: ORG,
      role: pending.role,
      canPublish: pending.canPublish,
    },
    "req-1"
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("accepting a client-scoped invitation (session path)", () => {
  it("grants the clients' listings in the acceptance transaction", async () => {
    const pending = { role: "member", canPublish: true, clientIds: [CROWN] }
    const statements = fakeAcceptance({ pending, granted: ["l1", "l2"] })
    await expect(accept(pending)).resolves.toMatchObject({
      organisationId: ORG,
    })
    const grant = statements.find((s) =>
      s.text.includes("insert into location_member")
    )
    expect(grant?.values).toEqual([ORG, USER, true, { array: [CROWN] }])
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "member.invitation_accepted",
        metadata: expect.objectContaining({
          clientIds: [CROWN],
          scopedListings: 2,
        }),
      })
    )
  })

  it("never lets a scoped viewer publish", async () => {
    const pending = { role: "viewer", canPublish: true, clientIds: [CROWN] }
    const statements = fakeAcceptance({ pending, granted: ["l1"] })
    await accept(pending)
    const grant = statements.find((s) =>
      s.text.includes("insert into location_member")
    )
    expect(grant?.values[2]).toBe(false)
  })

  it("refuses when the clients hold no listings any more, instead of joining unscoped", async () => {
    const pending = { role: "member", canPublish: false, clientIds: [CROWN] }
    fakeAcceptance({ pending, granted: [] })
    await expect(accept(pending)).rejects.toMatchObject({
      status: 409,
      code: "invitation_scope_empty",
    })
  })

  it("leaves an unscoped invitation as all clients", async () => {
    const pending = { role: "member", canPublish: false, clientIds: null }
    const statements = fakeAcceptance({ pending })
    await accept(pending)
    expect(
      statements.some((s) => s.text.includes("insert into location_member"))
    ).toBe(false)
  })

  it("does not scope a membership the acceptance did not create", async () => {
    const pending = { role: "member", canPublish: false, clientIds: [CROWN] }
    const statements = fakeAcceptance({ pending, joined: false })
    await accept(pending)
    expect(
      statements.some((s) => s.text.includes("insert into location_member"))
    ).toBe(false)
  })
})

describe("client-access helpers", () => {
  it("grantClientListings and extendClientHolders do nothing for an empty list", async () => {
    const sql = Object.assign(vi.fn(), { array: vi.fn() })
    await expect(
      grantClientListings(sql as never, {
        organisationId: ORG,
        userId: USER,
        clientIds: [],
        canPublish: false,
      })
    ).resolves.toEqual([])
    await expect(
      extendClientHolders(sql as never, {
        organisationId: ORG,
        clientId: CROWN,
        locationIds: [],
      })
    ).resolves.toEqual([])
    expect(sql).not.toHaveBeenCalled()
  })

  it("extendClientHolders only extends people who hold every other listing", async () => {
    const sql = Object.assign(
      vi.fn((strings: TemplateStringsArray) => {
        return Promise.resolve([{ text: strings.join("?") }])
      }),
      { array: (values: unknown[]) => values }
    )
    const [result] = (await extendClientHolders(sql as never, {
      organisationId: ORG,
      clientId: CROWN,
      locationIds: ["new-1"],
    })) as unknown as { text: string }[]
    expect(result.text).toMatch(
      /having count\(distinct lm\.location_id\) = \(select count\(\*\) from others\)/
    )
    expect(result.text).toMatch(/id <> all/)
    expect(result.text).toMatch(
      /on conflict \(location_id, user_id\) do nothing/
    )
  })

  it("audits one extension per member", async () => {
    await auditExtendedGrants({} as never, {
      organisationId: ORG,
      actorUserId: USER,
      clientId: CROWN,
      requestId: "req-2",
      extended: [
        { userId: "a", locationId: "n1", canPublish: true },
        { userId: "a", locationId: "n2", canPublish: true },
        { userId: "b", locationId: "n1", canPublish: false },
      ],
    })
    expect(vi.mocked(writeAudit)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "member.client_access_extended",
        subjectId: "a",
        metadata: expect.objectContaining({
          clientId: CROWN,
          grants: [
            { locationId: "n1", canPublish: true },
            { locationId: "n2", canPublish: true },
          ],
        }),
      })
    )
  })
})
