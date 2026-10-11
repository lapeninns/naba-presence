import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  __resetDraftSources,
  peekStashedDraft,
  purgeForeignDrafts,
  stashDraft,
} from "@/lib/api/draft-stash"
import type { SessionResponse } from "@/lib/contracts/session"
import { draftIdentityPrefix, draftKey } from "@/lib/editors/draft-key"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { queryKeys } from "@/lib/queries/keys"

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})

const HOURS = { resource: "location-hours", resourceId: "loc-1", schemaVersion: 1 }

function session(userId: string, organisationId: string): SessionResponse {
  return {
    session: {
      userId,
      organisationId,
      organisationName: "Org",
      displayName: "Person",
      email: "person@example.com",
      role: "member",
      canPublish: false,
      workspaceMode: "business",
    },
  }
}

function withSession(value: SessionResponse | null) {
  const client = new QueryClient()
  if (value) client.setQueryData(queryKeys.session, value)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("draftKey", () => {
  it("names the user, organisation, resource, resource id and schema version", () => {
    expect(
      draftKey({ userId: "u1", organisationId: "o1", ...HOURS })
    ).toBe("u:u1:o:o1:r:location-hours:loc-1:v1")
    expect(
      draftKey({ userId: "u1", organisationId: "o1", resource: "settings-policy", schemaVersion: 3 })
    ).toBe("u:u1:o:o1:r:settings-policy:-:v3")
  })

  it("differs for every part of the scope", () => {
    const base = draftKey({ userId: "u1", organisationId: "o1", ...HOURS })
    expect(draftKey({ userId: "u2", organisationId: "o1", ...HOURS })).not.toBe(base)
    expect(draftKey({ userId: "u1", organisationId: "o2", ...HOURS })).not.toBe(base)
    expect(draftKey({ userId: "u1", organisationId: "o1", ...HOURS, resourceId: "loc-2" })).not.toBe(base)
    expect(draftKey({ userId: "u1", organisationId: "o1", ...HOURS, schemaVersion: 2 })).not.toBe(base)
  })

  it("encodes segments so an id cannot impersonate another identity", () => {
    const forged = draftKey({ userId: "u1:o:o2", organisationId: "o1", ...HOURS })
    expect(forged.startsWith(draftIdentityPrefix({ userId: "u1", organisationId: "o2" }))).toBe(false)
    expect(forged).toContain("u1%3Ao%3Ao2")
  })

  it("marks an unknown identity, which no signed-in prefix matches", () => {
    const anonymous = draftKey({ userId: null, organisationId: null, ...HOURS })
    expect(anonymous.startsWith("u:-:o:-:")).toBe(true)
  })
})

describe("useDraftKey", () => {
  it("takes the identity from the cached session and follows it", () => {
    const { client, wrapper } = withSession(session("u1", "o1"))
    const { result } = renderHook(() => useDraftKey(HOURS), { wrapper })
    expect(result.current).toBe(draftKey({ userId: "u1", organisationId: "o1", ...HOURS }))
    act(() => client.setQueryData(queryKeys.session, session("u2", "o1")))
    expect(result.current).toBe(draftKey({ userId: "u2", organisationId: "o1", ...HOURS }))
  })
})

describe("purgeForeignDrafts", () => {
  it("removes stashes of other people, other organisations and unknown identities", () => {
    const mine = draftKey({ userId: "u1", organisationId: "o1", ...HOURS })
    const theirs = draftKey({ userId: "u2", organisationId: "o1", ...HOURS })
    const otherOrg = draftKey({ userId: "u1", organisationId: "o2", ...HOURS })
    const anonymous = draftKey({ userId: null, organisationId: null, ...HOURS })
    for (const key of [mine, theirs, otherOrg, anonymous]) stashDraft(key, "{}")
    stashDraft("legacy-unscoped", "{}")
    sessionStorage.setItem("unrelated", "kept")

    purgeForeignDrafts({ userId: "u1", organisationId: "o1" })

    expect(peekStashedDraft(mine)).toBe("{}")
    for (const key of [theirs, otherOrg, anonymous, "legacy-unscoped"]) {
      expect(peekStashedDraft(key)).toBeNull()
    }
    expect(sessionStorage.getItem("unrelated")).toBe("kept")
  })

  it("keeps everything while the identity is unknown", () => {
    stashDraft("legacy-unscoped", "{}")
    purgeForeignDrafts({ userId: null, organisationId: null })
    expect(peekStashedDraft("legacy-unscoped")).toBe("{}")
  })
})

describe("useEditorDraft stash scoping", () => {
  const initial = { name: "Server" }

  it("does not offer a stash written by another user in the same organisation", () => {
    stashDraft(
      draftKey({ userId: "u2", organisationId: "o1", ...HOURS }),
      JSON.stringify({ name: "Someone else's" })
    )
    const { wrapper } = withSession(session("u1", "o1"))
    const { result } = renderHook(
      () => useEditorDraft({ initial, revision: "1", scope: HOURS }),
      { wrapper }
    )
    expect(result.current.stashed).toBe(false)
  })

  it("does not offer a stash written in another organisation", () => {
    stashDraft(
      draftKey({ userId: "u1", organisationId: "o2", ...HOURS }),
      JSON.stringify({ name: "Other org" })
    )
    const { wrapper } = withSession(session("u1", "o1"))
    const { result } = renderHook(
      () => useEditorDraft({ initial, revision: "1", scope: HOURS }),
      { wrapper }
    )
    expect(result.current.stashed).toBe(false)
  })

  it("offers the signed-in person's own stash", () => {
    stashDraft(
      draftKey({ userId: "u1", organisationId: "o1", ...HOURS }),
      JSON.stringify({ name: "Mine" })
    )
    const { wrapper } = withSession(session("u1", "o1"))
    const { result } = renderHook(
      () => useEditorDraft({ initial, revision: "1", scope: HOURS }),
      { wrapper }
    )
    expect(result.current.stashed).toBe(true)
    act(() => result.current.restoreStashed())
    expect(result.current.draft).toEqual({ name: "Mine" })
  })

  it("ignores a stash from an older schema version", () => {
    stashDraft(
      draftKey({ userId: "u1", organisationId: "o1", ...HOURS, schemaVersion: 1 }),
      JSON.stringify({ name: "Old shape" })
    )
    const { wrapper } = withSession(session("u1", "o1"))
    const { result } = renderHook(
      () =>
        useEditorDraft({
          initial,
          revision: "1",
          scope: { ...HOURS, schemaVersion: 2 },
        }),
      { wrapper }
    )
    expect(result.current.stashed).toBe(false)
  })

  it("drops an offered stash when the identity changes under it", () => {
    stashDraft(
      draftKey({ userId: "u1", organisationId: "o1", ...HOURS }),
      JSON.stringify({ name: "Mine" })
    )
    const { client, wrapper } = withSession(session("u1", "o1"))
    const { result } = renderHook(
      () => useEditorDraft({ initial, revision: "1", scope: HOURS }),
      { wrapper }
    )
    expect(result.current.stashed).toBe(true)
    act(() => client.setQueryData(queryKeys.session, session("u2", "o1")))
    expect(result.current.stashed).toBe(false)
  })
})
