import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "@/app/api/audit-log/route"
import { withTenant } from "@/lib/server/db"

vi.mock("@/lib/server/audit", () => ({
  writeAudit: vi.fn(),
}))

vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(),
}))

vi.mock("@/lib/server/session", () => ({
  requireSession: vi.fn(async () => ({
    organisationId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    userId: "00000000-0000-4000-8000-000000000002",
  })),
  requireRole: vi.fn((session) => session),
}))

const row = (action: string) => ({
  id: "00000000-0000-4000-8000-000000000003",
  createdAt: "2026-07-30T00:00:00.000Z",
  action,
  subjectType: "review",
  subjectId: "review-1",
  actorUserId: null,
  actorEmail: null,
  requestId: null,
  metadata: {},
})

async function exportedActionCell(action: string) {
  vi.mocked(withTenant).mockResolvedValueOnce([row(action)] as never)
  const response = await GET(
    new Request("http://localhost/api/audit-log?format=csv")
  )
  expect(response.status).toBe(200)
  return (await response.text()).split("\n")[1]?.split(",")[2]
}

describe("audit CSV escaping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(["=SUM(A1)", "+cmd", "-1+2", "@formula", "\tcommand", "\rcommand"])(
    "guards spreadsheet formula prefix %j",
    async (value) => {
      expect(await exportedActionCell(value)).toBe(`"'${value}"`)
    }
  )

  it("leaves benign strings unchanged", async () => {
    expect(await exportedActionCell("review.published")).toBe(
      '"review.published"'
    )
  })

  it("preserves CSV quote doubling after guarding", async () => {
    expect(await exportedActionCell('=HYPERLINK("https://example.test")')).toBe(
      `"'=HYPERLINK(""https://example.test"")"`
    )
  })
})
