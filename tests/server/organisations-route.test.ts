import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { PATCH } from "@/app/api/organisations/route"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))

const ORG = "00000000-0000-4000-8000-000000000001"

const owner: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  organisationName: "Aman's organisation",
  displayName: "Aman",
  email: "aman@example.test",
  role: "owner",
  canPublish: true,
}

function signedIn(session: Session) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => session),
  } as never)
}

function patch(body: object) {
  return PATCH(
    new Request("http://localhost/api/organisations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
})

beforeEach(() => {
  vi.clearAllMocks()
  const sql = vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve([{ organisationId: ORG, name: values[0] }])
  )
  vi.mocked(withTenant).mockImplementation(async (_org, fn) => fn(sql as never))
})

describe("PATCH /api/organisations", () => {
  it("renames the organisation for an owner and audits the change", async () => {
    signedIn(owner)
    const response = await patch({ name: "  Lapen Inns  " })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      organisation: { organisationId: ORG, name: "Lapen Inns" },
    })
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "organisation.renamed",
        metadata: expect.objectContaining({
          previousName: "Aman's organisation",
          name: "Lapen Inns",
        }),
      })
    )
  })

  it("refuses an admin", async () => {
    signedIn({ ...owner, role: "admin" })
    const response = await patch({ name: "Lapen Inns" })
    expect(response.status).toBe(403)
    expect(vi.mocked(withTenant)).not.toHaveBeenCalled()
  })

  it("refuses a blank name", async () => {
    signedIn(owner)
    const response = await patch({ name: "   " })
    expect(response.status).toBe(400)
  })
})
