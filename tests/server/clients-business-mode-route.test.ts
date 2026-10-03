import { cookies } from "next/headers"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/clients/route"
import { getDatabase, withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

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
  workspaceMode: "business",
  displayName: "Aman",
  email: "aman@example.test",
  role: "owner",
  canPublish: true,
}

function post(body: object) {
  return POST(
    new Request("http://localhost/api/clients", {
      method: "POST",
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
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => owner),
  } as never)
})

describe("POST /api/clients in business mode", () => {
  it("answers 409 business_mode_single_client and inserts nothing", async () => {
    const queries: string[] = []
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?")
      queries.push(text)
      return Promise.resolve(
        text.includes("workspace_mode") ? [{ workspaceMode: "business" }] : []
      )
    })
    vi.mocked(withTenant).mockImplementation(async (_org, fn) =>
      fn(sql as never)
    )
    const response = await post({ name: "Second client" })
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).toContain(
      "business_mode_single_client"
    )
    expect(queries.some((text) => text.includes("insert into client"))).toBe(
      false
    )
  })
})
