import { describe, expect, it, vi } from "vitest"

import { invitationsResponseSchema } from "@/lib/contracts/invitations"
import { membersResponseSchema } from "@/lib/contracts/members"
import { notificationPreferencesResponseSchema } from "@/lib/contracts/operational-notifications"
import { sessionSchema } from "@/lib/contracts/session"
import { orgSettingsSchema } from "@/lib/contracts/settings"
import { NOTIFICATION_EVENT_KINDS } from "@/lib/domain/notification-preferences"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { sessionScopeToken } from "@/lib/queries/session-scope"
import {
  notificationSettingsPrefetch,
  prefetch,
  readInvitations,
  readMembers,
  readNotificationPreferences,
  readOrgSettings,
  replyPolicyPrefetch,
  teamPrefetch,
} from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

// SET-22 (P20): /team, /settings/notifications and Reply policy hydrate what
// their hooks read on mount. The readers are the ones the routes call
// (app/api/members, app/api/invitations, app/api/settings,
// app/api/notifications/preferences), covered by their own route tests; this
// file pins the contract with the client cache: the right keys, for the
// roles the routes answer, in the shape `apiFetch` would have produced.
const SQL = { tag: "tenant-sql" }
vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(async (_org: string, fn: (sql: unknown) => unknown) =>
    fn(SQL)
  ),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/server/members", () => ({ loadMembers: vi.fn() }))
vi.mock("@/lib/server/invitations/list", () => ({
  loadInvitations: vi.fn(),
}))
vi.mock("@/lib/server/org-settings", () => ({ loadOrgSettings: vi.fn() }))
vi.mock("@/lib/server/notifications/inbox", () => ({
  readNotificationPreferences: vi.fn(),
}))

const ORG = "00000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000002"
const AT = new Date("2026-10-01T09:30:00.000Z")

const owner: Session = {
  sessionId: "00000000-0000-4000-8000-000000000020",
  userId: USER,
  organisationId: ORG,
  organisationName: "Org",
  workspaceMode: "agency",
  displayName: "Test",
  email: "test@example.test",
  role: "owner",
  canPublish: true,
}

const memberRow = {
  userId: USER,
  email: "test@example.test",
  displayName: "Test",
  role: "owner",
  canPublish: true,
  locationScope: "all",
  createdAt: AT,
  locations: [],
}

const invitationRow = {
  id: "00000000-0000-4000-8000-000000000050",
  email: "new@example.test",
  role: "member",
  canPublish: false,
  clients: null,
  locations: null,
  locationScope: "all",
  expiresAt: "2026-10-08T09:30:00.000Z",
  acceptedAt: null,
  createdAt: "2026-10-01T09:30:00.000Z",
  inviteUrl: "http://localhost:3000/invite/token",
  delivery: null,
}

const keys = (entries: { queryKey: readonly unknown[] }[]) =>
  entries.map((entry) => entry.queryKey)

describe("teamPrefetch", () => {
  it("hydrates the members and invitations an owner or admin reads", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(keys(teamPrefetch()({ ...owner, role }))).toEqual([
        queryKeys.members,
        queryKeys.invitations,
      ])
    }
  })

  it("reads nothing for a member or viewer, whom both routes refuse", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(teamPrefetch()({ ...owner, role })).toEqual([])
    }
  })

  it("keeps the members when the invitations read fails", async () => {
    const { loadMembers } = await import("@/lib/server/members")
    const { loadInvitations } = await import("@/lib/server/invitations/list")
    vi.mocked(loadMembers).mockResolvedValueOnce({
      members: [memberRow],
      clients: [],
    } as never)
    vi.mocked(loadInvitations).mockRejectedValueOnce(new Error("db down"))
    const client = makeQueryClient()
    await prefetch(owner, teamPrefetch(), client)
    expect(client.getQueryData(queryKeys.members)).toMatchObject({
      members: [{ userId: USER }],
    })
    expect(client.getQueryData(queryKeys.invitations)).toBeUndefined()
  })
})

// #195 (P1): the browser hydrates a payload only into the scope it was read
// under (lib/queries/hydration-boundary.tsx `inLiveScope`), so a payload
// replayed by Back after a role change is refused. The stamp must be the
// token the browser computes from the same session.
describe("the scope stamp on every payload", () => {
  const composers = [
    ["Team", teamPrefetch()],
    ["Notifications", notificationSettingsPrefetch()],
    ["Reply policy", replyPolicyPrefetch()],
  ] as const

  for (const [name, composer] of composers) {
    it(`stamps the ${name} payload with the session's scope token`, async () => {
      for (const role of ["owner", "admin", "member", "viewer"] as const) {
        const reader = { ...owner, role }
        const state = await prefetch(reader, composer)
        expect(state.scope).toBe(sessionScopeToken(sessionSchema.parse(reader)))
        expect(state.scope).toContain(`\n${role}\n`)
      }
    })
  }

  it("differs for another person, organisation or scope fingerprint", async () => {
    const base = (await prefetch(owner, replyPolicyPrefetch())).scope
    for (const other of [
      { ...owner, userId: "00000000-0000-4000-8000-000000000003" },
      { ...owner, organisationId: "00000000-0000-4000-8000-000000000009" },
      { ...owner, scopeFingerprint: "narrower" },
      { ...owner, canPublish: false },
    ]) {
      expect((await prefetch(other, replyPolicyPrefetch())).scope).not.toBe(
        base
      )
    }
  })

  it("is empty without a session, whose payload is empty too", async () => {
    const state = await prefetch(null, teamPrefetch())
    expect(state).toMatchObject({ queries: [], scope: "" })
  })
})

describe("settings page composers", () => {
  it("notificationSettingsPrefetch hydrates the person's own choices, for every role", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(keys(notificationSettingsPrefetch()({ ...owner, role }))).toEqual([
        queryKeys.notificationPreferences,
      ])
    }
  })

  it("replyPolicyPrefetch hydrates the settings every role reads", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(keys(replyPolicyPrefetch()({ ...owner, role }))).toEqual([
        queryKeys.settings,
      ])
    }
  })
})

describe("readers", () => {
  it("readMembers reads in the session's tenant and sends dates over the wire", async () => {
    const { withTenant } = await import("@/lib/server/db")
    const { loadMembers } = await import("@/lib/server/members")
    vi.mocked(loadMembers).mockResolvedValueOnce({
      members: [memberRow],
      clients: [{ clientId: "c1", name: "Client", archived: false, total: 2 }],
    } as never)
    const out = await readMembers(owner)
    expect(withTenant).toHaveBeenLastCalledWith(ORG, expect.any(Function))
    expect(loadMembers).toHaveBeenLastCalledWith(SQL)
    expect(membersResponseSchema.safeParse(out).success).toBe(true)
    expect(out.members[0].createdAt).toBe("2026-10-01T09:30:00.000Z")
  })

  it("readInvitations reads the session's organisation and parses with the contract", async () => {
    const { loadInvitations } = await import("@/lib/server/invitations/list")
    vi.mocked(loadInvitations).mockResolvedValueOnce({
      items: [invitationRow],
      emailDelivery: true,
    } as never)
    const out = await readInvitations(owner)
    expect(loadInvitations).toHaveBeenLastCalledWith(SQL, ORG)
    expect(invitationsResponseSchema.safeParse(out).success).toBe(true)
    expect(out.emailDelivery).toBe(true)
  })

  it("readOrgSettings returns what useSettings holds, the route's `settings`", async () => {
    const { loadOrgSettings } = await import("@/lib/server/org-settings")
    vi.mocked(loadOrgSettings).mockResolvedValueOnce({
      approvalRequired: true,
      requireTwoPersonApproval: false,
      rawContentRetentionDays: 30,
      defaultLanguageCode: "en",
      defaultTimezone: "Europe/London",
      directPublishConsentAt: AT,
    } as never)
    const out = await readOrgSettings(owner)
    expect(loadOrgSettings).toHaveBeenLastCalledWith(SQL, ORG)
    expect(orgSettingsSchema.safeParse(out).success).toBe(true)
    expect(out.directPublishConsentAt).toBe("2026-10-01T09:30:00.000Z")
  })

  it("readOrgSettings throws a payload the client parser would refuse, so the key stays empty", async () => {
    const { loadOrgSettings } = await import("@/lib/server/org-settings")
    vi.mocked(loadOrgSettings).mockResolvedValueOnce({
      approvalRequired: "yes",
    } as never)
    const client = makeQueryClient()
    await prefetch(owner, replyPolicyPrefetch(), client)
    expect(client.getQueryData(queryKeys.settings)).toBeUndefined()
  })

  it("readNotificationPreferences passes the route's answer through the wire", async () => {
    const { readNotificationPreferences: load } =
      await import("@/lib/server/notifications/inbox")
    const payload = {
      emailConfigured: false,
      preferences: [
        {
          kind: NOTIFICATION_EVENT_KINDS[0],
          channel: "in_app",
          mode: "immediate",
          explicit: false,
        },
      ],
    }
    vi.mocked(load).mockResolvedValueOnce(payload as never)
    const out = await readNotificationPreferences(owner)
    expect(load).toHaveBeenLastCalledWith(owner)
    expect(notificationPreferencesResponseSchema.safeParse(out).success).toBe(
      true
    )
    expect(out).toEqual(payload)
  })
})
