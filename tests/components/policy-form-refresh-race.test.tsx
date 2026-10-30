import {
  type DehydratedState,
  dehydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { PolicyForm } from "@/components/settings/policy-form"
import { Toaster } from "@/components/ui/toast"
import type { OrgSettings } from "@/lib/api/settings"
import {
  alignForCache,
  HydrationBoundary,
} from "@/lib/queries/hydration-boundary"
import { queryKeys } from "@/lib/queries/keys"

// #195: the Reply policy page is server-rendered with its settings (P20), so
// every router.refresh() hands PolicyForm a new settings snapshot. A rename
// refreshed as soon as it landed, while the policy write was still on its
// way; that refresh read the old policy and, delivered after the save's own
// refetch, was dated by its arrival and hydrated over the saved settings.
// Discard then brought the old value back and the next unrelated save sent
// it. Only the network, router, session and capabilities are stood in for:
// the form, the boundary, useSettings and the QueryClient are the real ones.

const db = vi.hoisted(() => ({ settings: null as OrgSettings | null }))
const fetchSettingsMock = vi.hoisted(() => vi.fn())
const saveSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/settings", () => ({
  fetchSettings: fetchSettingsMock,
  saveSettings: saveSettingsMock,
}))
const renameMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/session", () => ({
  renameOrganisation: renameMock,
}))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/settings/policy",
}))
vi.mock("@/lib/queries/use-session", () => ({
  useSession: () => ({
    data: {
      session: {
        role: "owner",
        organisationName: "Acme Reviews",
        workspaceMode: "agency",
      },
    },
  }),
}))
vi.mock("@/lib/queries/use-settings-capabilities", () => ({
  useSettingsCapabilities: () => ({
    data: {
      canManageTeam: true,
      canManageConnections: true,
      canEditSettings: true,
    },
  }),
}))

function makeSettings(overrides: Partial<OrgSettings> = {}): OrgSettings {
  return {
    bannedPhrases: [],
    approvalRequired: true,
    requireTwoPersonApproval: false,
    rawContentRetentionDays: 14,
    defaultLanguageCode: "en-GB",
    defaultTimezone: "Europe/London",
    directPublishConsentAt: null,
    ...overrides,
  }
}

/** What replyPolicyPrefetch hands the page: the settings as the server reads them now. */
function serverSnapshot(): DehydratedState {
  const server = new QueryClient()
  server.setQueryData(queryKeys.settings, db.settings)
  return dehydrate(server)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// This page load started half a second before the first test's render, as
// a browser's would; only Date is faked from there.
const NAVIGATION_START = Date.now() - 500
let clock = 0
function tick(ms: number) {
  clock += ms
  vi.setSystemTime(clock)
}

/**
 * The page with a fresh cache, and `deliver`: a server payload (the first
 * render's or a refresh's) reaching the page's boundary.
 */
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
  const page = (state: DehydratedState) => (
    <QueryClientProvider client={client}>
      <Toaster>
        <HydrationBoundary state={state}>
          <PolicyForm role="owner" />
        </HydrationBoundary>
      </Toaster>
    </QueryClientProvider>
  )
  const { rerender } = render(page(serverSnapshot()))
  return {
    client,
    // TanStack hydrates a query the cache already holds in an effect and
    // tells the form on a timer tick after that, so wait that out too.
    deliver: async (state: DehydratedState) => {
      await act(async () => {
        rerender(page(state))
      })
      await act(() => new Promise((done) => setTimeout(done, 0)))
    },
  }
}

const twoPerson = () =>
  screen.getByRole("switch", {
    name: "Require a second person to approve each reply",
  })
const saveBar = () =>
  screen.queryByRole("region", { name: "Save reply policy" })

beforeAll(() => {
  vi.spyOn(performance, "timeOrigin", "get").mockReturnValue(NAVIGATION_START)
})

beforeEach(() => {
  clock = Date.now()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(clock)
  db.settings = makeSettings()
  fetchSettingsMock.mockImplementation(async () => db.settings)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("Reply policy: a rename and a policy save together (#195)", () => {
  it("refreshes only after both writes, and a late old snapshot never replaces the saved policy", async () => {
    const { client, deliver } = mount()
    expect(twoPerson()).not.toBeChecked()

    // 1. Rename and turn the two-person rule on, then one Save.
    const rename = deferred<{ name: string }>()
    const save = deferred<OrgSettings>()
    renameMock.mockReturnValue(rename.promise)
    saveSettingsMock.mockReturnValueOnce(save.promise)
    const refreshReads: DehydratedState[] = []
    refresh.mockImplementation(() => refreshReads.push(serverSnapshot()))
    fireEvent.change(screen.getByRole("textbox", { name: "Agency name" }), {
      target: { value: "Acme Local" },
    })
    fireEvent.click(twoPerson())
    tick(1_000)
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))

    // 2. The rename lands first. The page isn't refreshed yet: the policy
    // write hasn't landed, so the server would still read the old policy.
    tick(100)
    await act(async () => rename.resolve({ name: "Acme Local" }))
    expect(refresh).not.toHaveBeenCalled()
    // What any refresh made now would carry, delivered late below.
    const readBeforeSave = serverSnapshot()

    // 3. The policy write lands and the settings are refetched.
    tick(100)
    db.settings = makeSettings({ requireTwoPersonApproval: true })
    await act(async () => save.resolve(db.settings!))
    expect(await screen.findByText("Settings saved")).toBeInTheDocument()
    await waitFor(() => expect(saveBar()).not.toBeInTheDocument())
    expect(fetchSettingsMock).toHaveBeenCalled()

    // Then one refresh, which reads the saved policy.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refreshReads).toHaveLength(1)

    // 4. The old snapshot arrives after all that.
    tick(1_000)
    await deliver(readBeforeSave)
    expect(
      client.getQueryData<OrgSettings>(queryKeys.settings)
        ?.requireTwoPersonApproval
    ).toBe(true)
    expect(twoPerson()).toBeChecked()
    expect(saveBar()).not.toBeInTheDocument()

    // And the refresh's own read is the saved policy.
    tick(100)
    await deliver(refreshReads[0]!)
    expect(twoPerson()).toBeChecked()
    expect(saveBar()).not.toBeInTheDocument()

    // 5. Discard an edit, then save an unrelated one: the two-person rule
    // the owner turned on goes with it.
    await userEvent.click(
      screen.getByRole("combobox", { name: "How long we keep review text" })
    )
    await userEvent.click(
      await screen.findByRole("option", { name: "30 days" })
    )
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Discard" }))
    expect(twoPerson()).toBeChecked()
    await userEvent.click(
      screen.getByRole("combobox", { name: "How long we keep review text" })
    )
    await userEvent.click(await screen.findByRole("option", { name: "7 days" }))
    saveSettingsMock.mockResolvedValueOnce(
      makeSettings({
        requireTwoPersonApproval: true,
        rawContentRetentionDays: 7,
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(2))
    expect(saveSettingsMock.mock.calls[1]![0]).toEqual({
      approvalRequired: true,
      requireTwoPersonApproval: true,
      rawContentRetentionDays: 7,
      defaultLanguageCode: "en-GB",
      defaultTimezone: "Europe/London",
      bannedPhrases: [],
      directPublishConsent: false,
    })
  })

  it("still takes a newer server read over the cached settings", async () => {
    const { client, deliver } = mount()
    // Someone else turns the two-person rule on; a later refresh reads it.
    tick(60_000)
    db.settings = makeSettings({ requireTwoPersonApproval: true })
    const later = serverSnapshot()
    tick(300)
    await deliver(later)
    expect(
      client.getQueryData<OrgSettings>(queryKeys.settings)
        ?.requireTwoPersonApproval
    ).toBe(true)
    // The form saves from it: an unrelated edit keeps the rule on.
    await userEvent.click(
      screen.getByRole("combobox", { name: "How long we keep review text" })
    )
    await userEvent.click(await screen.findByRole("option", { name: "7 days" }))
    saveSettingsMock.mockResolvedValueOnce(
      makeSettings({
        requireTwoPersonApproval: true,
        rawContentRetentionDays: 7,
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0]![0]).toMatchObject({
      requireTwoPersonApproval: true,
      rawContentRetentionDays: 7,
    })
    // A policy-only save refreshes too, so the router's copy of the page
    // that Back restores carries the saved policy.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  // The release review's browser repro: save, leave through an in-app link,
  // press Back. Next mounts the first load's payload again; aligned anew it
  // looked as fresh as the Back and showed the policy from before the save.
  for (const [when, dropped] of [
    ["while the settings are still cached", false],
    ["after TanStack has dropped the unused settings", true],
  ] as const) {
    it(`shows the saved policy on Back after a save, ${when}`, async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
      })
      const page = (state: DehydratedState | null) => (
        <QueryClientProvider client={client}>
          <Toaster>
            {state ? (
              <HydrationBoundary state={state}>
                <PolicyForm role="owner" />
              </HydrationBoundary>
            ) : (
              <p>Inbox</p>
            )}
          </Toaster>
        </QueryClientProvider>
      )
      const firstLoad = serverSnapshot()
      const view = render(page(firstLoad))
      saveSettingsMock.mockImplementationOnce(
        async (input: { requireTwoPersonApproval: boolean }) =>
          (db.settings = makeSettings({
            requireTwoPersonApproval: input.requireTwoPersonApproval,
          }))
      )
      tick(1_000)
      fireEvent.click(twoPerson())
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      expect(await screen.findByText("Settings saved")).toBeInTheDocument()
      expect(twoPerson()).toBeChecked()

      tick(5_000)
      await act(async () => view.rerender(page(null)))
      if (dropped) client.removeQueries({ queryKey: queryKeys.settings })
      tick(60_000)
      await act(async () => view.rerender(page(firstLoad)))
      await act(() => new Promise((done) => setTimeout(done, 0)))

      await waitFor(() => expect(twoPerson()).toBeChecked())
      expect(saveBar()).not.toBeInTheDocument()
      expect(
        client.getQueryData<OrgSettings>(queryKeys.settings)
          ?.requireTwoPersonApproval
      ).toBe(true)
    })
  }

  it("doesn't refresh when nothing was saved", async () => {
    mount()
    renameMock.mockRejectedValue(new Error("boom"))
    fireEvent.change(screen.getByRole("textbox", { name: "Agency name" }), {
      target: { value: "Acme Local" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(
      await within(
        await screen.findByRole("region", { name: "Save reply policy" })
      ).findByText("Not saved")
    ).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("alignForCache", () => {
  const SERVER_NOW = Date.parse("2026-10-16T05:00:00.000Z")
  // The browser's clock is a minute ahead of the server's.
  const OFFSET = 60_000
  const NAVIGATION = SERVER_NOW + OFFSET - 400

  function stateAt(serverNow: number): DehydratedState {
    vi.setSystemTime(serverNow)
    const server = new QueryClient()
    server.setQueryData(queryKeys.settings, makeSettings())
    return dehydrate(server)
  }
  const updatedAt = (state: DehydratedState) =>
    state.queries[0]!.state.dataUpdatedAt

  it("aligns a query the cache doesn't hold by its own skew, as before", () => {
    const client = new QueryClient()
    const state = stateAt(SERVER_NOW)
    const arrival = SERVER_NOW + OFFSET + 2_000
    expect(
      updatedAt(
        alignForCache(state, client, {
          now: arrival,
          navigationStart: NAVIGATION,
          page: { first: Number.POSITIVE_INFINITY },
        })
      )
    ).toBe(arrival)
  })

  it("dates a held query no later than its server read, however late it arrives", () => {
    const client = new QueryClient()
    const page = { first: Number.POSITIVE_INFINITY }
    alignForCache(stateAt(SERVER_NOW), client, {
      now: SERVER_NOW + OFFSET + 2_000,
      navigationStart: NAVIGATION,
      page,
    })
    client.setQueryData(queryKeys.settings, makeSettings())
    const readAt = SERVER_NOW + 10_000
    const late = alignForCache(stateAt(readAt), client, {
      now: readAt + OFFSET + 5_000,
      navigationStart: NAVIGATION,
      page,
    })
    expect(updatedAt(late)).toBeLessThanOrEqual(readAt + OFFSET)
    // Still newer than anything the browser fetched before that read.
    expect(updatedAt(late)).toBeGreaterThan(SERVER_NOW + OFFSET + 2_000)
  })
})
