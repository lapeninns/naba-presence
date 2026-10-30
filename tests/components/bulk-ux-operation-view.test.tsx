import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { BulkOperationView } from "@/components/bulk/bulk-operation-view"
import type { BulkOperationView as Operation } from "@/lib/contracts/bulk-listings"

const ME = "00000000-0000-4000-8000-0000000000e9"
const session = vi.hoisted(() => ({
  role: "owner",
  userId: "00000000-0000-4000-8000-0000000000e9",
}))
vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => session.role,
  useSession: () => ({
    data: { session: { role: session.role, userId: session.userId } },
  }),
}))
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

const input = {
  operation: "special_hours" as const,
  dates: [{ action: "closed" as const, date: "2026-12-25" }],
}
const child = (
  index: number,
  overrides: Partial<Operation["children"][number]> = {}
): Operation["children"][number] => ({
  id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
  locationId: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`,
  locationName: `Inn ${index}`,
  eligibility: "eligible",
  skipReason: null,
  status: "previewed",
  confirmationState: "unrecorded",
  resultCode: null,
  currentValue: null,
  proposedValue: null,
  updateMask: ["specialHours"],
  attempts: 0,
  finishedAt: null,
  mutationOperationId: null,
  seq: 0,
  itemKey: "0:special_hours",
  operation: "special_hours",
  input,
  dependsOn: [],
  ...overrides,
})

const base: Operation = {
  id: "00000000-0000-4000-8000-0000000000b1",
  operation: "special_hours",
  items: [input],
  status: "previewed",
  previewHash: "a".repeat(64),
  requestedBy: "00000000-0000-4000-8000-0000000000e1",
  approvedBy: null,
  requiresSecondApprover: false,
  canApprove: true,
  approvalExpiresAt: "2099-10-02T00:00:00.000Z",
  previewExpiresAt: "2099-10-02T00:00:00.000Z",
  dispatchExpiresAt: null,
  createdAt: "2026-09-30T00:00:00.000Z",
  finishedAt: null,
  counts: { previewed: 1 },
  children: [child(1)],
}

const running = (): Operation => ({
  ...base,
  status: "running",
  approvedBy: base.requestedBy,
  dispatchExpiresAt: "2099-10-03T00:00:00.000Z",
  counts: { succeeded: 1, running: 1, queued: 2 },
  children: [
    child(1, { status: "succeeded" }),
    child(2, { status: "running" }),
    child(3, { status: "queued" }),
    child(4, { status: "queued" }),
  ],
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

/** Answers GETs with `read()` and each POST by its last path segment. */
function serve(
  read: () => Response,
  posts: Record<string, () => Response> = {}
) {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === "POST") {
      const verb = String(url).split("/").pop()!
      return posts[verb]?.() ?? json({ error: "not_found" }, 404)
    }
    return read()
  })
  vi.stubGlobal("fetch", fetchMock)
  const gets = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST").length
  const postsTo = (verb: string) =>
    fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === "POST" && String(url).endsWith(verb)
    ).length
  return { gets, postsTo }
}

afterEach(() => {
  session.role = "owner"
  session.userId = ME
  vi.unstubAllGlobals()
  vi.useRealTimers()
  push.mockReset()
})

/** The words in the action bar's status, beside its buttons. */
const barStatus = () =>
  screen
    .getByRole("region", { name: "Bulk change actions" })
    .querySelector<HTMLElement>('[data-slot="action-bar-status"]')

describe("a refresh that fails (p4-F14 C1)", () => {
  it("keeps the running batch on screen and says it is the last known state", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let fail = false
    const api = serve(() =>
      fail
        ? json({ error: "internal", message: "Something went wrong." }, 500)
        : json({ operation: running() })
    )
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    expect(await screen.findByText("Inn 1")).toBeInTheDocument()
    fail = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(
      await screen.findByText(
        /^Couldn’t refresh at \d\d:\d\d\. Showing the last known state; trying again\.$/
      )
    ).toBeInTheDocument()
    expect(api.gets()).toBeGreaterThanOrEqual(2)
    // The batch, its progress and its actions are all still there.
    expect(screen.getByText("Inn 4")).toBeInTheDocument()
    expect(
      screen.getByText(/1 of 4 listings confirmed on Google/)
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Stop listings not yet sent" })
    ).toBeInTheDocument()
    expect(screen.queryByText("The bulk change could not be loaded")).toBeNull()
  })
})

describe("cancelling (p4-F14 C2)", () => {
  it("asks before stopping a running batch, with the server's counts", async () => {
    let current = running()
    const api = serve(() => json({ operation: current }), {
      cancel: () => {
        current = { ...running(), status: "cancelled" }
        return json({ operation: current })
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await user.click(
      await screen.findByRole("button", { name: "Stop listings not yet sent" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Stop 2 listings not yet sent?")
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      "1 confirmed listing keeps its change. The one already sending finishes. This can’t be undone."
    )
    // Keeping it is the default and sends nothing. The dialog moves focus
    // after it opens, so wait for it.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Keep sending" })
      ).toHaveFocus()
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Keep sending" })
    )
    expect(api.postsTo("/cancel")).toBe(0)
    await user.click(
      screen.getByRole("button", { name: "Stop listings not yet sent" })
    )
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Stop sending",
      })
    )
    await vi.waitFor(() => expect(api.postsTo("/cancel")).toBe(1))
    expect(
      await screen.findByText(/^Cancelled\. Listings already confirmed/)
    ).toBeInTheDocument()
  })

  it("names a previewed batch's cancel as discarding a preview that sent nothing", async () => {
    serve(() => json({ operation: base }))
    const user = userEvent.setup()
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await user.click(
      await screen.findByRole("button", { name: "Discard this preview" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Discard this preview?")
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent("Nothing has been sent to Google.")
    expect(
      within(dialog).getByRole("button", { name: "Discard preview" })
    ).toBeInTheDocument()
  })
})

describe("polling (p4-F14 C3)", () => {
  it("keeps reading a cancelled batch while a listing is still sending", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const api = serve(() =>
      json({
        operation: {
          ...running(),
          status: "cancelled",
          counts: { succeeded: 1, running: 1, cancelled: 2 },
          children: [
            child(1, { status: "succeeded" }),
            child(2, { status: "running" }),
            child(3, { status: "cancelled" }),
          ],
        },
      })
    )
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    expect(
      await screen.findByText(
        "1 listing is still finishing; this page updates on its own."
      )
    ).toBeInTheDocument()
    const first = api.gets()
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(() => expect(api.gets()).toBeGreaterThan(first))
  })

  it("stops reading once nothing in a cancelled batch can move", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const api = serve(() =>
      json({
        operation: {
          ...running(),
          status: "cancelled",
          counts: { succeeded: 1, cancelled: 1 },
          children: [
            child(1, { status: "succeeded" }),
            child(2, { status: "cancelled" }),
          ],
        },
      })
    )
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await screen.findByText(/^Cancelled\./)
    const first = api.gets()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.gets()).toBe(first)
    expect(screen.queryByText(/still finishing/)).toBeNull()
  })
})

describe("action errors and results (p4-F14 C4)", () => {
  it("reads the batch again after a conflict and says why in the bar", async () => {
    let approved = false
    const api = serve(
      () =>
        json({
          operation: approved
            ? { ...base, status: "approved", approvedBy: base.requestedBy }
            : base,
        }),
      {
        approve: () => {
          approved = true
          return json(
            {
              error: "bulk_not_previewed",
              message: "This bulk change was already approved.",
            },
            409
          )
        },
      }
    )
    const user = userEvent.setup()
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await user.click(
      await screen.findByRole("button", { name: "Approve this exact change" })
    )
    expect(
      await screen.findByRole("button", { name: "Start bulk change" })
    ).toBeInTheDocument()
    expect(api.gets()).toBe(2)
    expect(barStatus()).toHaveTextContent(
      "This bulk change was already approved."
    )
  })

  it("says why Approve can't be used, on the button and in the bar", async () => {
    serve(() => json({ operation: { ...base, canApprove: false } }))
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    const approve = await screen.findByRole("button", {
      name: "Approve this exact change",
    })
    expect(approve).toHaveAttribute("aria-disabled", "true")
    expect(approve).toHaveAccessibleDescription(
      "A different owner or administrator must approve"
    )
    expect(barStatus()).toHaveTextContent(
      "A different owner or administrator must approve"
    )
  })

  it("docks the bar with its own spacer and gives a long status its own row", async () => {
    serve(() => json({ operation: { ...base, canApprove: false } }))
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await screen.findByRole("button", { name: "Approve this exact change" })
    const bar = screen.getByRole("region", { name: "Bulk change actions" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    // The ActionBar's spacer measures the bar (status row and all) and feeds
    // the scroll padding, rather than a padding that assumes one row; it
    // sits under the last outcome on a phone.
    const spacer = bar.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-slot="action-bar-spacer"]'
    )
    expect(spacer).not.toBeNull()
    expect(spacer?.nextElementSibling).toBe(bar)
    expect(bar.parentElement?.className).toMatch(
      /max-md:\[&>\[data-slot=action-bar-spacer\]\]:order-last/
    )
    expect(bar.parentElement?.className).not.toMatch(/--np-actionbar-h/)
    expect(bar.className).toMatch(/max-md:flex-wrap/)
    expect(barStatus()?.className).toMatch(/max-md:basis-full/)
    expect(barStatus()?.className).not.toMatch(/line-clamp/)
    expect(
      bar.querySelector('[data-slot="bulk-action-status"]')
    ).toHaveTextContent("A different owner or administrator must approve")
  })

  it("says so when a retry could requeue nothing", async () => {
    const finished: Operation = {
      ...running(),
      status: "completed_with_failures",
      counts: { succeeded: 1, failed: 1 },
      children: [
        child(1, { status: "succeeded" }),
        child(2, { status: "failed" }),
      ],
    }
    serve(() => json({ operation: finished }), {
      retry: () => json({ operation: finished }),
    })
    const user = userEvent.setup()
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await user.click(
      await screen.findByRole("button", { name: "Retry 1 unconfirmed listing" })
    )
    await vi.waitFor(() =>
      expect(barStatus()).toHaveTextContent(
        "Nothing could be retried yet: these listings need a new preview or are still being checked on Google."
      )
    )
  })
})

describe("a batch that isn't there (p4-F14 C5)", () => {
  it("says it wasn't found and offers no retry that can't work", async () => {
    serve(() =>
      json(
        {
          error: "bulk_operation_not_found",
          message: "Bulk change not found.",
        },
        404
      )
    )
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    expect(
      await screen.findByText("This bulk change wasn’t found")
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(
      screen.getByRole("link", { name: "Back to listings" })
    ).toHaveAttribute("href", "/listings")
  })

  it("still offers a retry when the load failed for another reason", async () => {
    serve(() => json({ error: "internal", message: "Boom." }, 500))
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    expect(
      await screen.findByText("The bulk change could not be loaded")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })
})

describe("who may stop or retry (p4-F14 C6)", () => {
  const review = (requestedBy: string): Operation => ({
    ...running(),
    operation: "review_approval",
    status: "completed_with_failures",
    requestedBy,
    canApprove: false,
    counts: { succeeded: 1, failed: 1 },
    children: [
      child(1, { status: "succeeded", operation: "review_approval" }),
      child(2, { status: "failed", operation: "review_approval" }),
    ],
  })

  it("lets the member who started a review batch retry it, as the server does", async () => {
    session.role = "member"
    serve(() => json({ operation: review(ME) }))
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    expect(
      await screen.findByRole("button", { name: "Retry 1 unconfirmed listing" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Only owners and admins can approve, start, cancel/)
    ).toBeNull()
  })

  it("tells a member they can stop their running review batch but not approve or start", async () => {
    session.role = "member"
    serve(() =>
      json({
        operation: {
          ...review(ME),
          status: "approved",
          counts: { previewed: 2 },
          children: [
            child(1, { operation: "review_approval" }),
            child(2, { operation: "review_approval" }),
          ],
        },
      })
    )
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    expect(
      await screen.findByRole("button", { name: "Stop listings not yet sent" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Start bulk change" })
    ).toBeNull()
    expect(
      screen.getByText(
        "Only owners and admins can approve or start a bulk change."
      )
    ).toBeInTheDocument()
  })

  it("gives a member no controls on someone else's review batch or a listing batch", async () => {
    session.role = "member"
    serve(() => json({ operation: review(base.requestedBy) }))
    const { unmount } = renderWithProviders(
      <BulkOperationView operationId={base.id} />
    )
    expect(
      await screen.findByText(
        "Only owners and admins can approve, start, cancel or retry a bulk change."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull()
    unmount()
    serve(() =>
      json({
        operation: { ...running(), requestedBy: ME },
      })
    )
    renderWithProviders(<BulkOperationView operationId={base.id} />)
    await screen.findByText("Inn 1", { exact: false })
    expect(
      screen.queryByRole("button", { name: "Stop listings not yet sent" })
    ).toBeNull()
  })
})
