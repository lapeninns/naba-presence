import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  describeChildChange as describeChange,
  maskLabel,
} from "@/components/bulk/bulk-change-summary"
import { BulkOperationView } from "@/components/bulk/bulk-operation-view"
import type { BulkOperationView as Operation } from "@/lib/contracts/bulk-listings"

const describeChildChange = (
  operation: Operation["children"][number]["operation"],
  input: unknown,
  child: Pick<
    Operation["children"][number],
    "currentValue" | "proposedValue" | "updateMask"
  >
) =>
  describeChange({
    operation,
    input: input as Operation["children"][number]["input"],
    ...child,
  })

vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => "owner",
}))
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

const specialInput = {
  operation: "special_hours" as const,
  dates: [
    { action: "closed" as const, date: "2026-12-25" },
    {
      action: "open" as const,
      date: "2026-12-26",
      opensAt: "12:00",
      closesAt: "18:00",
    },
  ],
}

const child = (overrides: Partial<Operation["children"][number]>) => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  locationId: "00000000-0000-4000-8000-0000000000d1",
  locationName: "Old Crown",
  eligibility: "eligible" as const,
  skipReason: null,
  status: "previewed" as const,
  confirmationState: "unrecorded" as const,
  resultCode: null,
  currentValue: null,
  proposedValue: null,
  updateMask: [],
  attempts: 0,
  finishedAt: null,
  mutationOperationId: null,
  seq: 0,
  itemKey: "0:special_hours",
  operation: "special_hours" as const,
  input: specialInput,
  dependsOn: [],
  ...overrides,
})

const operation: Operation = {
  id: "00000000-0000-4000-8000-0000000000b1",
  operation: "special_hours",
  items: [specialInput],
  status: "previewed",
  previewHash: "a".repeat(64),
  requestedBy: "00000000-0000-4000-8000-0000000000e1",
  approvedBy: null,
  requiresSecondApprover: false,
  canApprove: true,
  approvalExpiresAt: "2026-10-02T00:00:00.000Z",
  previewExpiresAt: "2099-10-02T00:00:00.000Z",
  dispatchExpiresAt: null,
  createdAt: "2026-09-30T00:00:00.000Z",
  finishedAt: null,
  counts: { previewed: 1 },
  children: [
    child({
      currentValue: {
        specialHourPeriods: [
          {
            startDate: { year: 2026, month: 12, day: 26 },
            openTime: { hours: 10 },
            closeTime: { hours: 16 },
          },
        ],
      },
      proposedValue: {
        specialHourPeriods: [
          {
            startDate: { year: 2026, month: 12, day: 25 },
            endDate: { year: 2026, month: 12, day: 25 },
            closed: true,
          },
          {
            startDate: { year: 2026, month: 12, day: 26 },
            endDate: { year: 2026, month: 12, day: 26 },
            openTime: { hours: 12, minutes: 0 },
            closeTime: { hours: 18, minutes: 0 },
            closed: false,
          },
        ],
      },
      updateMask: ["specialHours"],
    }),
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  push.mockReset()
})

describe("BulkOperationView", () => {
  it("shows each listing's exact special-hours change, never the raw mask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ operation }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    const change = await screen.findByRole("list", {
      name: "Change for Old Crown",
    })
    const rows = within(change).getAllByRole("listitem")
    expect(rows.map((row) => row.textContent)).toEqual([
      "Fri, 25 Dec 2026: Not set →changes to Closed",
      "Sat, 26 Dec 2026: Open 10:00–16:00 →changes to Open 12:00–18:00",
    ])
    expect(screen.queryByText(/specialHours/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Approve by /)).toBeInTheDocument()
  })

  it("shows a child whose dispatch window closed as expired and not sent, with no retry", async () => {
    const expired: Operation = {
      ...operation,
      status: "completed_with_failures",
      approvedBy: operation.requestedBy,
      dispatchExpiresAt: "2026-10-02T00:00:00.000Z",
      counts: { expired: 1 },
      children: [
        child({
          status: "expired",
          resultCode: "dispatch_expired",
          updateMask: ["specialHours"],
        }),
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ operation: expired }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
    renderWithProviders(<BulkOperationView operationId={expired.id} />)
    expect(await screen.findByText("Expired, not sent")).toBeInTheDocument()
    expect(
      screen.getByText(/the approval lasts 24 hours; prepare a new preview/)
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 expired, not sent")
    expect(
      screen.queryByRole("button", { name: /Retry/ })
    ).not.toBeInTheDocument()
  })

  const serve = (view: Operation) =>
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ operation: view }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )

  it("says a preview that was never approved expired at the 15-minute stage", async () => {
    serve({
      ...operation,
      status: "expired",
      canApprove: false,
      counts: { expired: 1 },
      children: [child({ status: "expired", resultCode: "preview_expired" })],
    })
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    expect(
      await screen.findByText(/wasn’t approved within 15 minutes/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/approval lasts 24 hours/)
    ).not.toBeInTheDocument()
  })

  it("says a running batch's sending window has closed once it has", async () => {
    serve({
      ...operation,
      status: "running",
      canApprove: false,
      approvedBy: operation.requestedBy,
      dispatchExpiresAt: "2026-10-02T00:00:00.000Z",
      counts: { expired: 1 },
      children: [child({ status: "expired", resultCode: "dispatch_expired" })],
    })
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    expect(
      await screen.findByText(/^The sending window closed at /)
    ).toBeInTheDocument()
    expect(screen.queryByText(/will not be sent/)).not.toBeInTheDocument()
  })
})

describe("BulkOperationView with several changes", () => {
  it("labels each listing's changes in order and says which wait for earlier ones", async () => {
    const first = "00000000-0000-4000-8000-0000000000c1"
    const wifi = {
      operation: "attributes" as const,
      changes: [{ name: "attributes/has_wifi", values: [true] }],
    }
    const view: Operation = {
      ...operation,
      operation: "mixed",
      items: [specialInput, wifi],
      status: "running",
      canApprove: false,
      approvedBy: operation.requestedBy,
      dispatchExpiresAt: "2099-10-02T00:00:00.000Z",
      counts: { running: 1, queued: 1 },
      children: [
        child({ id: first, status: "running", updateMask: ["specialHours"] }),
        child({
          id: "00000000-0000-4000-8000-0000000000c2",
          seq: 1,
          itemKey: "1:attributes",
          operation: "attributes",
          input: wifi,
          status: "queued",
          dependsOn: [first],
          currentValue: [{ name: "attributes/has_wifi", values: [false] }],
          proposedValue: [{ name: "attributes/has_wifi", values: [true] }],
          updateMask: ["attributes/has_wifi"],
        }),
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ operation: view }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
    renderWithProviders(<BulkOperationView operationId={view.id} />)
    expect(
      await screen.findByRole("heading", {
        name: "Several changes across 1 listing",
      })
    ).toBeInTheDocument()
    expect(screen.getByText("1. Special hours")).toBeInTheDocument()
    expect(screen.getByText("2. Attributes")).toBeInTheDocument()
    expect(
      screen.getByText("Waits for the earlier changes to this listing")
    ).toBeInTheDocument()
    const second = screen.getByRole("list", {
      name: "Change 2 for Old Crown",
    })
    expect(within(second).getByRole("listitem")).toHaveTextContent(
      "Has wifi: No →changes to Yes"
    )
  })
})

describe("describeChildChange", () => {
  it("lists only the weekdays whose regular hours change", () => {
    const period = (day: string, open: number, close: number) => ({
      openDay: day,
      closeDay: day,
      openTime: { hours: open },
      closeTime: { hours: close },
    })
    const rows = describeChildChange(
      "regular_hours",
      { operation: "regular_hours", days: [] } as never,
      {
        currentValue: {
          periods: [period("MONDAY", 9, 17), period("TUESDAY", 9, 17)],
        },
        proposedValue: {
          periods: [period("MONDAY", 9, 17), period("TUESDAY", 10, 22)],
        },
        updateMask: ["regularHours"],
      }
    )
    expect(rows).toEqual([
      { label: "Tuesday", current: "09:00–17:00", proposed: "10:00–22:00" },
    ])
  })

  it("names the service-hours type and its weekly times", () => {
    const rows = describeChildChange(
      "more_hours",
      { operation: "more_hours", hoursTypeId: "HAPPY_HOURS", periods: [] },
      {
        currentValue: [],
        proposedValue: [
          {
            hoursTypeId: "HAPPY_HOURS",
            periods: [
              {
                openDay: "FRIDAY",
                closeDay: "FRIDAY",
                openTime: { hours: 17 },
                closeTime: { hours: 19 },
              },
            ],
          },
        ],
        updateMask: ["moreHours"],
      }
    )
    expect(rows).toEqual([
      { label: "Happy hours", current: "None", proposed: "Fri 17:00–19:00" },
    ])
  })

  it("names attributes and their values", () => {
    const rows = describeChildChange(
      "attributes",
      {
        operation: "attributes",
        changes: [{ name: "attributes/has_wifi", values: [true] }],
      },
      {
        currentValue: [{ name: "attributes/has_wifi", values: [false] }],
        proposedValue: [{ name: "attributes/has_wifi", values: [true] }],
        updateMask: ["attributes/has_wifi"],
      }
    )
    expect(rows).toEqual([
      { label: "Has wifi", current: "No", proposed: "Yes" },
    ])
  })

  it("says which action link is added, updated or removed", () => {
    const input = {
      operation: "place_action" as const,
      action: "upsert" as const,
      placeActionType: "DINING_RESERVATION",
      uri: "https://book.example.test",
      isPreferred: true,
    }
    expect(
      describeChildChange("place_action", input, {
        currentValue: [],
        proposedValue: {
          create: {
            uri: "https://book.example.test",
            placeActionType: "DINING_RESERVATION",
            isPreferred: true,
          },
        },
        updateMask: [],
      })
    ).toEqual([
      {
        label: "Reserve a table",
        current: "No link for this button",
        proposed: "Add https://book.example.test (preferred)",
      },
    ])
    expect(
      describeChildChange(
        "place_action",
        { ...input, action: "delete" },
        {
          currentValue: [
            {
              name: "locations/1/placeActionLinks/9",
              uri: "https://old.example.test",
              isPreferred: false,
            },
          ],
          proposedValue: { delete: "locations/1/placeActionLinks/9" },
          updateMask: ["locations/1/placeActionLinks/9"],
        }
      )
    ).toEqual([
      {
        label: "Reserve a table",
        current: "https://old.example.test",
        proposed: "Removed",
      },
    ])
  })

  it("labels update masks in plain English", () => {
    expect(maskLabel("specialHours")).toBe("Special hours")
    expect(maskLabel("regularHours")).toBe("Opening hours")
    expect(maskLabel("moreHours")).toBe("Service hours")
    expect(maskLabel("attributes/has_wifi")).toBe("Has wifi")
    expect(maskLabel("locations/1/placeActionLinks/9")).toBe(
      "An existing action link"
    )
  })
})

describe("BulkOperationView follow-ups (P09-R9)", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })

  it("counts the preview's approval window down and stops approval once it closes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    vi.setSystemTime(new Date("2026-10-01T23:59:50.000Z"))
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({
          operation: {
            ...operation,
            previewExpiresAt: "2026-10-02T00:00:00.000Z",
          },
        })
      )
    )
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    expect(await screen.findByText("0:10 left")).toBeInTheDocument()
    const approve = screen.getByRole("button", {
      name: "Approve this exact change",
    })
    expect(approve).toBeEnabled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(
      await screen.findByText(
        /This preview expired at .* can no longer be approved/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Approve this exact change" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "New preview for 1 listing not sent" })
    ).toBeInTheDocument()
  })

  it("counts the window down by the server's clock, not the browser's", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    // The browser's clock is 55 s behind the server's.
    vi.setSystemTime(new Date("2026-10-01T23:59:00.000Z"))
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({
          operation: {
            ...operation,
            previewExpiresAt: "2026-10-02T00:00:00.000Z",
            serverTime: "2026-10-01T23:59:55.000Z",
          },
        })
      )
    )
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    expect(await screen.findByText("0:05 left")).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(
      screen.getByRole("button", { name: "Approve this exact change" })
    ).toBeDisabled()
  })

  it("leaves a post draft out of a new preview that would make it again at a listing", async () => {
    const post = {
      operation: "post_draft" as const,
      post: {
        topicType: "STANDARD" as const,
        languageCode: "en-GB",
        summary: "Quiz night",
        media: [],
      },
    }
    const hours = {
      operation: "regular_hours" as const,
      days: [
        {
          dayOfWeek: 1,
          isClosed: false,
          periods: [{ opensAt: "09:00", closesAt: "17:00" }],
        },
      ],
    }
    const listingB = "00000000-0000-4000-8000-0000000000d2"
    const asPost = {
      operation: "post_draft" as const,
      input: post,
      itemKey: "0:post_draft",
    }
    const asHours = {
      operation: "regular_hours" as const,
      input: hours,
      seq: 1,
      itemKey: "1:regular_hours",
    }
    const view: Operation = {
      ...operation,
      operation: "mixed",
      items: [post, hours],
      status: "completed_with_failures",
      canApprove: false,
      approvedBy: operation.requestedBy,
      dispatchExpiresAt: "2026-10-02T00:00:00.000Z",
      counts: { succeeded: 2, conflict: 1, expired: 1 },
      children: [
        child({ ...asPost, status: "succeeded" }),
        child({
          ...asHours,
          id: "00000000-0000-4000-8000-0000000000c2",
          status: "conflict",
          resultCode: "google_baseline_changed",
        }),
        child({
          ...asPost,
          id: "00000000-0000-4000-8000-0000000000c3",
          locationId: listingB,
          locationName: "White Horse",
          status: "expired",
          resultCode: "dispatch_expired",
        }),
        child({
          ...asHours,
          id: "00000000-0000-4000-8000-0000000000c4",
          locationId: listingB,
          locationName: "White Horse",
          status: "succeeded",
        }),
      ],
    }
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/preview")
        ? json({
            operation: {
              ...operation,
              id: "00000000-0000-4000-8000-0000000000b2",
            },
          })
        : json({ operation: view })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<BulkOperationView operationId={view.id} />)
    expect(
      await screen.findByText(
        /Not in the new preview: change 1 \(Post drafts\) at White Horse\. A post draft is made again/
      )
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "New preview for 1 listing not sent" })
    )
    await vi.waitFor(() => expect(push).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/listings/bulk/preview")
    )
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      locationIds: [operation.children[0].locationId],
      items: [hours],
    })
  })

  it("prepares a new preview of only the conflicted and expired listings, with their changes in order", async () => {
    const wifi = {
      operation: "attributes" as const,
      changes: [{ name: "attributes/has_wifi", values: [true] }],
    }
    const listingB = "00000000-0000-4000-8000-0000000000d2"
    const view: Operation = {
      ...operation,
      operation: "mixed",
      items: [specialInput, wifi],
      status: "completed_with_failures",
      canApprove: false,
      approvedBy: operation.requestedBy,
      dispatchExpiresAt: "2026-10-02T00:00:00.000Z",
      counts: { succeeded: 2, conflict: 1, expired: 1 },
      children: [
        child({ status: "succeeded" }),
        child({
          id: "00000000-0000-4000-8000-0000000000c2",
          seq: 1,
          itemKey: "1:attributes",
          operation: "attributes",
          input: wifi,
          status: "conflict",
          resultCode: "google_baseline_changed",
        }),
        child({
          id: "00000000-0000-4000-8000-0000000000c3",
          locationId: listingB,
          locationName: "White Horse",
          status: "succeeded",
        }),
        child({
          id: "00000000-0000-4000-8000-0000000000c4",
          locationId: listingB,
          locationName: "White Horse",
          seq: 1,
          itemKey: "1:attributes",
          operation: "attributes",
          input: wifi,
          status: "expired",
          resultCode: "dispatch_expired",
        }),
      ],
    }
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/preview")
        ? json({
            operation: {
              ...operation,
              id: "00000000-0000-4000-8000-0000000000b2",
            },
          })
        : json({ operation: view })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<BulkOperationView operationId={view.id} />)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "New preview for 2 listings not sent",
      })
    )
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/listings/bulk/00000000-0000-4000-8000-0000000000b2"
      )
    )
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/listings/bulk/preview")
    )
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      locationIds: [operation.children[0].locationId, listingB],
      items: [wifi],
    })
  })

  it("shows a listing's receipt only when asked, read from GET /api/mutations/{id}", async () => {
    const receiptId = "00000000-0000-4000-8000-0000000000f1"
    const view: Operation = {
      ...operation,
      status: "completed",
      canApprove: false,
      approvedBy: operation.requestedBy,
      counts: { succeeded: 1 },
      children: [
        child({ status: "succeeded", mutationOperationId: receiptId }),
      ],
    }
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/api/mutations/")
        ? json({
            operation: {
              id: receiptId,
              intentId: receiptId,
              surface: "hours",
              action: "hours_publish",
              outcome: "confirmed_applied",
              locationId: operation.children[0].locationId,
              targetType: null,
              targetRef: null,
              errorCode: null,
              attemptId: null,
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
            },
          })
        : json({ operation: view })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(<BulkOperationView operationId={view.id} />)
    const show = await screen.findByRole("button", {
      name: "Show receipt for Old Crown",
    })
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/api/mutations/")
      )
    ).toBe(false)
    expect(show).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(show)
    expect(await screen.findByText(`Receipt ${receiptId}`)).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith(`/api/mutations/${receiptId}`)
        )
      ).toBe(true)
    )
    expect(
      screen.getByRole("button", { name: "Hide receipt for Old Crown" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("offers no new preview for a review batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        json({
          operation: {
            ...operation,
            operation: "review_approval",
            status: "completed_with_failures",
            canApprove: false,
            counts: { expired: 1 },
            children: [
              child({
                operation: "review_approval",
                status: "expired",
                resultCode: "dispatch_expired",
                input: {
                  operation: "review_approval",
                  reviewId: "00000000-0000-4000-8000-0000000000a1",
                  draftId: "00000000-0000-4000-8000-0000000000a2",
                  reviewUpdateTime: "2026-10-01T00:00:00.000Z",
                },
                reviewId: "00000000-0000-4000-8000-0000000000a1",
              }),
            ],
          },
        })
      )
    )
    renderWithProviders(<BulkOperationView operationId={operation.id} />)
    expect(
      await screen.findByRole("link", { name: "Open the review for Old Crown" })
    ).toHaveAttribute(
      "href",
      "/inbox?selected=00000000-0000-4000-8000-0000000000a1"
    )
    expect(
      screen.queryByRole("button", { name: /New preview/ })
    ).not.toBeInTheDocument()
  })
})
