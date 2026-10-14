import { beforeEach, describe, expect, it, vi } from "vitest"

// Rows the fake database answers, keyed by the table each guard reads.
const unresolved = { placeAction: false, gbpMutation: false }
const queries: string[] = []

vi.mock("@/lib/server/db", () => ({
  withSessionConnection: vi.fn(),
  withTenant: vi.fn(
    async (_organisationId: string, work: (sql: unknown) => unknown) =>
      work(async (strings: TemplateStringsArray) => {
        const text = strings.join("?")
        queries.push(text)
        if (text.includes("from place_action_mutation"))
          return unresolved.placeAction ? [{ id: "pa" }] : []
        if (text.includes("from gbp_management_mutation"))
          return unresolved.gbpMutation ? [{ id: "gm" }] : []
        throw new Error(`unexpected query: ${text}`)
      })
  ),
}))
vi.mock("@/lib/server/gbp-management", () => ({
  resolveGbpLocationContext: vi.fn(),
}))

const { requireNoUnresolvedAccountChange } =
  await import("@/lib/server/google-account-change-lock")
const { ApiError } = await import("@/lib/server/http")

const session = { organisationId: "org-1", userId: "user-1" } as Parameters<
  typeof requireNoUnresolvedAccountChange
>[0]

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as InstanceType<typeof ApiError>
}

describe("requireNoUnresolvedAccountChange", () => {
  beforeEach(() => {
    unresolved.placeAction = false
    unresolved.gbpMutation = false
    queries.length = 0
  })

  it("passes when nothing on the account is unresolved, checking action links first", async () => {
    await expect(
      requireNoUnresolvedAccountChange(session, "acct-1")
    ).resolves.toBeUndefined()
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain("from place_action_mutation")
    expect(queries[1]).toContain("from gbp_management_mutation")
  })

  // The one predicate the access, lifecycle and action-link senders share.
  it("checks every access and lifecycle state that leaves an outcome open", async () => {
    await requireNoUnresolvedAccountChange(session, "acct-1")
    const predicate = queries[1]!.replace(/\s+/g, " ")
    expect(predicate).toContain(
      "resource_type in ('account_admin', 'location_admin', 'invitation', 'location_lifecycle')"
    )
    expect(predicate).toContain(
      "status in ('started', 'validated', 'ambiguous')"
    )
    expect(predicate).toContain(
      "confirmation_state in ('pending', 'unresolved')"
    )
    expect(predicate).toContain(
      "local_reconciliation_state in ('pending', 'conflict')"
    )
  })

  it("refuses an unresolved action link before reading access changes", async () => {
    unresolved.placeAction = true
    const error = await refusal(
      requireNoUnresolvedAccountChange(session, "acct-1", "caller wording")
    )
    expect(error.status).toBe(409)
    expect(error.code).toBe("google_confirmation_unresolved")
    expect(error.message).toMatch(/action link change/)
    expect(queries).toHaveLength(1)
  })

  it("refuses an unresolved access or lifecycle change in the caller's words", async () => {
    unresolved.gbpMutation = true
    const error = await refusal(
      requireNoUnresolvedAccountChange(session, "acct-1", "caller wording")
    )
    expect(error.status).toBe(409)
    expect(error.code).toBe("google_confirmation_unresolved")
    expect(error.message).toBe("caller wording")
  })

  it("keeps the action-link wording when no caller wording is given", async () => {
    unresolved.gbpMutation = true
    const error = await refusal(
      requireNoUnresolvedAccountChange(session, "acct-1")
    )
    expect(error.message).toBe(
      "An access or lifecycle change awaits confirmation. Read its saved outcome before changing action links."
    )
  })
})
