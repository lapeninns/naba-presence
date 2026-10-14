import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LegalHoldsPanel } from "@/components/settings/legal-holds-panel"
import { PrivacyExportForm } from "@/components/settings/privacy-export-form"
import { PrivacyRequestsPanel } from "@/components/settings/privacy-requests-panel"
import { PrivacySettings } from "@/components/settings/privacy-settings"
import { SettingsNav } from "@/components/settings/settings-nav"
import type {
  PrivacyErasurePreview,
  PrivacyExportResponse,
  PrivacyRequest,
} from "@/lib/contracts/privacy"
import { queryKeys } from "@/lib/queries/keys"
import { privacyAccessFromRole, privacyGating } from "@/lib/settings/gating"
import {
  assembleSubjectExport,
  describeErasurePreview,
  exportFilename,
  presentPrivacyRequest,
  sortPrivacyRequests,
} from "@/lib/settings/privacy"
import { renderWithProviders } from "../helpers/render"

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/privacy",
}))

const OWNER = privacyGating("manage")
const ADMIN = privacyGating("read")

function request(
  overrides: Partial<PrivacyRequest> & { id: string }
): PrivacyRequest {
  return {
    requestType: "erasure",
    status: "pending",
    subjectReference: `Subject ${overrides.id}`,
    reason: null,
    requestedBy: "u1",
    resolvedBy: null,
    resolutionNote: null,
    resolvedAt: null,
    dueAt: "2099-02-01T00:00:00.000Z",
    overdue: false,
    withdrawalStalled: false,
    withdrawalAttempts: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

/** A fetch stub routed by "METHOD path". Unrouted calls fail the test. */
function stubFetch(routes: Record<string, Handler>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected fetch ${key}`)
    return handler(init)
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function preview(overrides: Partial<PrivacyErasurePreview> = {}) {
  return {
    preview: {
      reviews: 1,
      reviewers: 1,
      matchedByNameOnly: 0,
      locations: 1,
      repliesToWithdraw: 1,
      heldReviews: 0,
      confirmation: "token-1",
      ...overrides,
    },
  }
}

describe("privacy gating", () => {
  it("lets an owner manage, an admin read, and nobody in while the feature is off", () => {
    expect(privacyAccessFromRole("owner", true)).toBe("manage")
    expect(privacyAccessFromRole("admin", true)).toBe("read")
    expect(privacyAccessFromRole("member", true)).toBe("none")
    expect(privacyAccessFromRole("viewer", true)).toBe("none")
    expect(privacyAccessFromRole("owner", false)).toBe("none")
    expect(OWNER).toEqual({
      canViewPrivacy: true,
      canCreateRequests: true,
      canManagePrivacy: true,
    })
    expect(ADMIN).toEqual({
      canViewPrivacy: true,
      canCreateRequests: true,
      canManagePrivacy: false,
    })
    expect(privacyGating("none").canViewPrivacy).toBe(false)
  })
})

describe("privacy request ordering and state", () => {
  const now = new Date("2099-03-01T00:00:00.000Z")

  it("puts stalled withdrawals first, then open by deadline, then resolved newest first", () => {
    const sorted = sortPrivacyRequests([
      request({
        id: "resolved-old",
        status: "completed",
        createdAt: "2098-01-01T00:00:00.000Z",
      }),
      request({ id: "open-late", dueAt: "2099-05-01T00:00:00.000Z" }),
      request({
        id: "resolved-new",
        status: "rejected",
        createdAt: "2098-06-01T00:00:00.000Z",
      }),
      request({ id: "open-soon", dueAt: "2099-02-01T00:00:00.000Z" }),
      request({
        id: "stalled",
        status: "in_progress",
        withdrawalStalled: true,
        dueAt: "2099-09-01T00:00:00.000Z",
      }),
    ])
    expect(sorted.map((item) => item.id)).toEqual([
      "stalled",
      "open-soon",
      "open-late",
      "resolved-new",
      "resolved-old",
    ])
  })

  it("marks an open request past its deadline overdue even before the server says so", () => {
    expect(presentPrivacyRequest(request({ id: "a" }), now).label).toBe(
      "Overdue"
    )
    expect(
      presentPrivacyRequest(
        request({ id: "b", dueAt: "2099-04-01T00:00:00.000Z" }),
        now
      ).label
    ).toBe("Pending")
    expect(
      presentPrivacyRequest(request({ id: "c", status: "completed" }), now)
        .label
    ).toBe("Completed")
    const stalled = presentPrivacyRequest(
      request({
        id: "d",
        status: "in_progress",
        withdrawalStalled: true,
        withdrawalAttempts: 12,
        lastErrorCode: "google_timeout",
      }),
      now
    )
    expect(stalled.label).toBe("Withdrawal stalled")
    expect(stalled.detail).toContain("after 12 attempts (google_timeout)")
  })
})

describe("erasure preview wording", () => {
  it("says when nothing matches, and asks no acknowledgement", () => {
    const empty = describeErasurePreview({
      ...preview({ reviews: 0, reviewers: 0, locations: 0 }).preview,
      repliesToWithdraw: 0,
    })
    expect(empty.title).toBe("No reviews match")
    expect(empty.acknowledge).toBeNull()
    expect(empty.submitLabel).toBe("Fulfil request")
  })

  it("asks for an acknowledgement only when the match may span people", () => {
    expect(describeErasurePreview(preview().preview).acknowledge).toBeNull()
    expect(
      describeErasurePreview(preview({ reviewers: 2, reviews: 2 }).preview)
        .acknowledge
    ).toMatch(/all 2 reviews belong to this person/)
    expect(
      describeErasurePreview(preview({ matchedByNameOnly: 1 }).preview)
        .acknowledge
    ).not.toBeNull()
  })

  it("names held reviews and replies to withdraw", () => {
    const held = describeErasurePreview(
      preview({ heldReviews: 1, repliesToWithdraw: 0 }).preview
    )
    expect(held.lines).toContain(
      "None of our replies needs withdrawing from Google."
    )
    expect(held.lines.at(-1)).toMatch(/1 review under a legal hold/)
  })
})

describe("PrivacyRequestsPanel", () => {
  it("lists requests in deadline order with overdue marked, and gives an owner fulfil and reject", async () => {
    stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [
            request({
              id: "r-done",
              status: "completed",
              subjectReference: "Done Person",
            }),
            request({
              id: "r-late",
              subjectReference: "Late Person",
              dueAt: "2000-01-01T00:00:00.000Z",
              overdue: true,
            }),
            request({ id: "r-open", subjectReference: "Open Person" }),
          ],
        }),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    const table = await screen.findByRole("table", { name: "Privacy requests" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows.map((row) => row.getAttribute("data-request-id"))).toEqual([
      "r-late",
      "r-open",
      "r-done",
    ])
    expect(within(rows[0]).getByText("Overdue")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Fulfil request for Late Person" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Reject request for Open Person" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Fulfil request for Done Person" })
    ).not.toBeInTheDocument()
  })

  it("offers no Reject on an erasure whose replies are still being withdrawn", async () => {
    stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [
            request({
              id: "r-retry",
              status: "in_progress",
              subjectReference: "Retrying Person",
              withdrawalAttempts: 1,
              nextAttemptAt: "2099-01-02T00:00:00.000Z",
            }),
            request({
              id: "r-stalled",
              status: "in_progress",
              subjectReference: "Stalled Person",
              withdrawalStalled: true,
              withdrawalAttempts: 5,
            }),
            request({
              id: "r-started",
              status: "in_progress",
              subjectReference: "Started Person",
            }),
          ],
        }),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await screen.findByRole("table", { name: "Privacy requests" })
    for (const name of ["Retrying Person", "Stalled Person"]) {
      expect(
        screen.getByRole("button", { name: `Fulfil request for ${name}` })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: `Reject request for ${name}` })
      ).not.toBeInTheDocument()
    }
    // In progress with nothing parked at Google can still be rejected.
    expect(
      screen.getByRole("button", { name: "Reject request for Started Person" })
    ).toBeInTheDocument()
  })

  it("lets an admin log requests but not resolve them", async () => {
    stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [request({ id: "r1", subjectReference: "Someone" })],
        }),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={ADMIN} />)
    await screen.findByRole("table", { name: "Privacy requests" })
    expect(
      screen.getByRole("button", { name: "Log a request" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Fulfil request for Someone" })
    ).not.toBeInTheDocument()
  })

  it("validates the subject before logging a request, then posts it", async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch({
      "GET /api/privacy/requests": () => json({ requests: [] }),
      "POST /api/privacy/requests": () =>
        json(
          {
            request: {
              id: "new",
              requestType: "access",
              status: "pending",
              subjectReference: "Jane Reviewer",
              createdAt: "2099-01-01T00:00:00.000Z",
            },
          },
          201
        ),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await screen.findByText("No privacy requests")
    await user.click(screen.getByRole("button", { name: "Log a request" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Subject reference"), "ab")
    await user.click(
      within(dialog).getByRole("button", { name: "Log request" })
    )
    expect(
      await within(dialog).findByText("Enter at least 3 characters.")
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBe(false)

    await user.clear(within(dialog).getByLabelText("Subject reference"))
    await user.type(
      within(dialog).getByLabelText("Subject reference"),
      "Jane Reviewer"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Log request" })
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
      ).toBeTruthy()
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, call]) => call?.method === "POST"
    )!
    expect(JSON.parse(String(init!.body))).toEqual({
      requestType: "access",
      subjectReference: "Jane Reviewer",
    })
  })

  it("keeps the fulfil dialog open with the hold explained when a legal hold blocks an erasure", async () => {
    const user = userEvent.setup()
    stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [request({ id: "r1", subjectReference: "Held Person" })],
        }),
      "GET /api/privacy/requests/r1/preview": () =>
        json(preview({ heldReviews: 1 })),
      "PATCH /api/privacy/requests": () =>
        json(
          {
            error: "privacy_legal_hold",
            message: "Matching reviews are protected by an active legal hold.",
            holds: ["00000000-0000-4000-8000-000000000001"],
          },
          409
        ),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await user.click(
      await screen.findByRole("button", {
        name: "Fulfil request for Held Person",
      })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByLabelText("Resolution note"),
      "Verified identity"
    )
    await user.click(
      await within(dialog).findByRole("button", { name: "Erase 1 review" })
    )
    expect(
      await within(dialog).findByText("A legal hold blocks this erasure")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Release the hold below/)
    ).toBeInTheDocument()
  })

  it("treats a reply Google would not drop as in progress, not a failure", async () => {
    const user = userEvent.setup()
    stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [request({ id: "r1", subjectReference: "Live Reply" })],
        }),
      "GET /api/privacy/requests/r1/preview": () => json(preview()),
      "PATCH /api/privacy/requests": () =>
        json(
          {
            error: "privacy_reply_withdraw_failed",
            message: "The reply could not be withdrawn from Google.",
            pending: [{ reviewId: "x", code: "google_timeout" }],
            request: {
              id: "r1",
              requestType: "erasure",
              status: "in_progress",
              subjectReference: "Live Reply",
              resolutionNote: "note",
              resolvedAt: null,
            },
          },
          409
        ),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await user.click(
      await screen.findByRole("button", {
        name: "Fulfil request for Live Reply",
      })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByLabelText("Resolution note"),
      "Verified identity"
    )
    await user.click(
      await within(dialog).findByRole("button", { name: "Erase 1 review" })
    )
    expect(
      await screen.findByText("Erased here; a reply is still live on Google")
    ).toBeInTheDocument()
    // The toast is announced in a dialog of its own; the fulfil dialog,
    // with its note field, is what has to go.
    await waitFor(() =>
      expect(screen.queryByLabelText("Resolution note")).not.toBeInTheDocument()
    )
  })

  it("shows what an erasure matches and sends its confirmation, ticked through when the name is shared", async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [request({ id: "r1", subjectReference: "Sam Smith" })],
        }),
      "GET /api/privacy/requests/r1/preview": () =>
        json(
          preview({
            reviews: 3,
            reviewers: 2,
            matchedByNameOnly: 3,
            locations: 2,
            repliesToWithdraw: 2,
            confirmation: "token-3",
          })
        ),
      "PATCH /api/privacy/requests": () =>
        json({
          request: {
            id: "r1",
            requestType: "erasure",
            status: "completed",
            subjectReference: "Sam Smith",
            resolutionNote: "Verified identity",
            resolvedAt: "2099-01-02T00:00:00.000Z",
          },
        }),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await user.click(
      await screen.findByRole("button", {
        name: "Fulfil request for Sam Smith",
      })
    )
    const dialog = await screen.findByRole("dialog")
    const summary = await within(dialog).findByTestId("erasure-preview")
    expect(summary).toHaveTextContent("This erasure matches 3 reviews")
    expect(summary).toHaveTextContent(
      "3 reviews from 2 reviewer profiles across 2 locations."
    )
    expect(summary).toHaveTextContent(/matched on the display name alone/)
    expect(summary).toHaveTextContent(
      "2 of our replies will be withdrawn from Google."
    )
    await user.type(
      within(dialog).getByLabelText("Resolution note"),
      "Verified identity"
    )
    const erase = within(dialog).getByRole("button", {
      name: "Erase 3 reviews",
    })
    expect(erase).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I’ve checked that all 3 reviews belong to this person.",
      })
    )
    await user.click(erase)
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
      ).toBe(true)
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    )!
    expect(JSON.parse(String(init?.body))).toEqual({
      id: "r1",
      action: "fulfil",
      resolutionNote: "Verified identity",
      confirmation: "token-3",
    })
  })

  it("counts again and erases nothing when the matches changed before the fulfil", async () => {
    const user = userEvent.setup()
    let previews = 0
    stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [request({ id: "r1", subjectReference: "Moving Set" })],
        }),
      "GET /api/privacy/requests/r1/preview": () => {
        previews += 1
        return json(
          previews === 1
            ? preview()
            : preview({ reviews: 2, reviewers: 1, confirmation: "token-2" })
        )
      },
      "PATCH /api/privacy/requests": () =>
        json(
          {
            error: "privacy_erasure_unconfirmed",
            message: "Nothing was erased.",
            preview: preview({ reviews: 2 }).preview,
          },
          409
        ),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await user.click(
      await screen.findByRole("button", {
        name: "Fulfil request for Moving Set",
      })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByLabelText("Resolution note"),
      "Verified identity"
    )
    await user.click(
      await within(dialog).findByRole("button", { name: "Erase 1 review" })
    )
    expect(
      await within(dialog).findByText("The matching reviews changed")
    ).toBeInTheDocument()
    expect(
      await within(dialog).findByRole("button", { name: "Erase 2 reviews" })
    ).toBeEnabled()
  })

  it("asks for a resolution note before rejecting", async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch({
      "GET /api/privacy/requests": () =>
        json({
          requests: [request({ id: "r1", subjectReference: "No Note" })],
        }),
    })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await user.click(
      await screen.findByRole("button", { name: "Reject request for No Note" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Reject request" })
    )
    expect(
      await within(dialog).findByText("Write a note of at least 3 characters.")
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBe(false)
  })
})

describe("LegalHoldsPanel", () => {
  const holds = {
    holds: [
      {
        id: "h-released",
        reviewId: "00000000-0000-4000-8000-0000000000aa",
        reason: "Closed matter",
        approvedBy: "u1",
        releasedBy: "u1",
        releasedAt: "2099-01-05T00:00:00.000Z",
        createdAt: "2099-01-04T00:00:00.000Z",
      },
      {
        id: "h-active",
        reviewId: "00000000-0000-4000-8000-0000000000bb",
        reason: "Litigation pending",
        approvedBy: "u1",
        releasedBy: null,
        releasedAt: null,
        createdAt: "2099-01-01T00:00:00.000Z",
      },
    ],
  }

  it("shows active holds first and lets an owner release them", async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch({
      "GET /api/legal-holds": () => json(holds),
      "DELETE /api/legal-holds": () => json({ released: true }),
    })
    renderWithProviders(<LegalHoldsPanel gating={OWNER} />)
    const table = await screen.findByRole("table", { name: "Legal holds" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(within(rows[0]).getByText("Held")).toBeInTheDocument()
    expect(within(rows[1]).getByText("Released")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: "Release hold on review 00000000-0000-4000-8000-0000000000bb",
      })
    )
    await user.click(
      await screen.findByRole("button", { name: "Release hold" })
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")
      ).toBeTruthy()
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, call]) => call?.method === "DELETE"
    )!
    expect(JSON.parse(String(init!.body))).toEqual({
      reviewId: "00000000-0000-4000-8000-0000000000bb",
    })
  })

  it("is read-only for an admin", async () => {
    stubFetch({ "GET /api/legal-holds": () => json(holds) })
    renderWithProviders(<LegalHoldsPanel gating={ADMIN} />)
    await screen.findByRole("table", { name: "Legal holds" })
    expect(
      screen.queryByRole("button", { name: "Apply a hold" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Release hold on/ })
    ).not.toBeInTheDocument()
  })

  it("validates the review id and reason before applying a hold", async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch({
      "GET /api/legal-holds": () => json({ holds: [] }),
    })
    renderWithProviders(<LegalHoldsPanel gating={OWNER} />)
    await screen.findByText("No legal holds")
    await user.click(screen.getByRole("button", { name: "Apply a hold" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByLabelText("Review identifier"),
      "not-a-uuid"
    )
    await user.type(within(dialog).getByLabelText("Reason"), "short")
    await user.click(within(dialog).getByRole("button", { name: "Apply hold" }))
    expect(
      await within(dialog).findByText("Enter the review identifier.")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText("Give a reason of at least 10 characters.")
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBe(false)
  })
})

function exportPage(
  overrides: Partial<PrivacyExportResponse>
): PrivacyExportResponse {
  return {
    generatedAt: "2099-01-01T10:00:00.000Z",
    organisationId: "org",
    subjectReference: "Jane",
    note: "Only still-retained content.",
    page: 1,
    pageSize: 2,
    totalMatched: 3,
    returned: 2,
    truncated: true,
    complete: false,
    addedDuringExport: 0,
    nextCursor: "cursor-1",
    reviews: [{ id: "a" }, { id: "b" }],
    ...overrides,
  }
}

describe("subject export", () => {
  it("joins every page and keeps the last page's verdict", () => {
    const joined = assembleSubjectExport([
      exportPage({}),
      exportPage({
        page: 2,
        generatedAt: "2099-01-01T10:00:05.000Z",
        returned: 1,
        truncated: false,
        complete: true,
        nextCursor: null,
        reviews: [{ id: "c" }],
      }),
    ])
    expect(joined.reviews.map((review) => review.id)).toEqual(["a", "b", "c"])
    expect(joined).toMatchObject({
      generatedAt: "2099-01-01T10:00:00.000Z",
      pages: 2,
      totalMatched: 3,
      complete: true,
    })
    expect(exportFilename(joined.generatedAt)).toBe(
      "privacy-export-2099-01-01.json"
    )
  })

  it("follows the cursor to the last page and resumes after a failed page", async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    let call = 0
    stubFetch({
      "POST /api/privacy/export": (init) => {
        bodies.push(JSON.parse(String(init?.body)))
        call += 1
        if (call === 1) return json(exportPage({}))
        if (call === 2)
          return json(
            { error: "internal_error", message: "Something broke." },
            500
          )
        return json(
          exportPage({
            page: 2,
            returned: 1,
            truncated: false,
            complete: true,
            nextCursor: null,
            reviews: [{ id: "c" }],
          })
        )
      },
    })
    renderWithProviders(<PrivacyExportForm />)
    await user.type(screen.getByLabelText("Subject reference"), "Jane")
    await user.click(screen.getByRole("button", { name: "Export records" }))
    expect(
      await screen.findByText("The export stopped part-way")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Resume export" }))
    expect(
      await screen.findByText("Export ready: 3 reviews")
    ).toBeInTheDocument()
    expect(bodies).toEqual([
      { subject: "Jane" },
      { subject: "Jane", cursor: "cursor-1" },
      { subject: "Jane", cursor: "cursor-1" },
    ])
  })

  it("shows a plain error with no resume when the first page fails", async () => {
    const user = userEvent.setup()
    stubFetch({
      "POST /api/privacy/export": () =>
        json(
          {
            error: "privacy_subject_not_found",
            message: "No reviews match that subject.",
          },
          404
        ),
    })
    renderWithProviders(<PrivacyExportForm />)
    await user.type(screen.getByLabelText("Subject reference"), "Nobody")
    await user.click(screen.getByRole("button", { name: "Export records" }))
    expect(
      await screen.findByText("The export didn’t start")
    ).toBeInTheDocument()
    expect(
      screen.getByText("No records matched that reference.")
    ).toBeInTheDocument()
    expect(screen.queryByText("The export stopped part-way")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Resume export" })
    ).not.toBeInTheDocument()
  })

  it("warns when reviews arrived during the export", async () => {
    const user = userEvent.setup()
    stubFetch({
      "POST /api/privacy/export": () =>
        json(
          exportPage({
            returned: 2,
            totalMatched: 2,
            nextCursor: null,
            complete: false,
            addedDuringExport: 1,
          })
        ),
    })
    renderWithProviders(<PrivacyExportForm />)
    await user.type(screen.getByLabelText("Subject reference"), "Jane")
    await user.click(screen.getByRole("button", { name: "Export records" }))
    expect(await screen.findByText("Export incomplete")).toBeInTheDocument()
    expect(screen.getByText(/1 matching review was stored/)).toBeInTheDocument()
  })
})

describe("PrivacySettings", () => {
  it("tells an admin the export is owner-only instead of showing the form", async () => {
    stubFetch({
      "GET /api/privacy/requests": () => json({ requests: [] }),
      "GET /api/legal-holds": () => json({ holds: [] }),
      "GET /api/privacy/retention-status": () =>
        json({
          lastCompletedCycle: {
            cycleDate: "2099-01-01",
            startedAt: "2099-01-01T03:00:00.000Z",
            completedAt: "2099-01-01T03:10:00.000Z",
            organisation: {
              status: "failed",
              attempts: 3,
              lastErrorCode: "internal_error",
              finishedAt: "2099-01-01T03:09:00.000Z",
            },
          },
          currentCycle: null,
          heldReviews: 2,
          heldLocations: 1,
          rawContentRetentionDays: 30,
          deletesEnabled: false,
        }),
    })
    renderWithProviders(<PrivacySettings access="read" />)
    expect(
      screen.queryByRole("heading", { name: "Export a subject’s records" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Only an owner can fulfil requests/)
    ).toBeInTheDocument()
    expect(
      await screen.findByText("Not retained (internal_error)")
    ).toBeInTheDocument()
    expect(screen.getByText("Paused")).toBeInTheDocument()
    expect(screen.getByText("30 days")).toBeInTheDocument()
  })
})

describe("SettingsNav privacy area", () => {
  function renderNav(role: string, privacy: "none" | "read" | "manage") {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(queryKeys.settingsCapabilities, {
      canManageTeam: true,
      canManageConnections: true,
      canEditSettings: true,
      privacy,
    })
    return render(
      <QueryClientProvider client={client}>
        <SettingsNav role={role} />
      </QueryClientProvider>
    )
  }

  it("offers Data and privacy only when the capability allows it", () => {
    const { unmount } = renderNav("owner", "manage")
    expect(
      screen.getByRole("link", { name: "Data and privacy" })
    ).toHaveAttribute("aria-current", "page")
    unmount()
    renderNav("owner", "none")
    expect(
      screen.queryByRole("link", { name: "Data and privacy" })
    ).not.toBeInTheDocument()
  })

  it("never offers it to a member, whatever the cache holds", () => {
    renderNav("member", "manage")
    expect(
      screen.queryByRole("link", { name: "Data and privacy" })
    ).not.toBeInTheDocument()
  })
})

describe("privacy overlays (mobile-first)", () => {
  it("asks before a stray dismissal throws away a half-logged request", async () => {
    const user = userEvent.setup()
    stubFetch({ "GET /api/privacy/requests": () => json({ requests: [] }) })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await screen.findByText("No privacy requests")
    await user.click(screen.getByRole("button", { name: "Log a request" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByLabelText("Subject reference"),
      "Jane Reviewer"
    )
    await user.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", {
      name: "Discard this request?",
    })
    await user.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(screen.getByLabelText("Subject reference")).toHaveValue(
      "Jane Reviewer"
    )

    await user.keyboard("{Escape}")
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await user.click(screen.getByRole("button", { name: "Log a request" }))
    expect(
      within(await screen.findByRole("dialog")).getByLabelText(
        "Subject reference"
      )
    ).toHaveValue("")
  })

  it("closes a clean request dialog on Escape without asking", async () => {
    const user = userEvent.setup()
    stubFetch({ "GET /api/privacy/requests": () => json({ requests: [] }) })
    renderWithProviders(<PrivacyRequestsPanel gating={OWNER} />)
    await screen.findByText("No privacy requests")
    await user.click(screen.getByRole("button", { name: "Log a request" }))
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("keeps the release confirmation open with the failure beside its buttons", async () => {
    const user = userEvent.setup()
    stubFetch({
      "GET /api/legal-holds": () =>
        json({
          holds: [
            {
              id: "h-active",
              reviewId: "00000000-0000-4000-8000-0000000000bb",
              reason: "Litigation pending",
              approvedBy: "u1",
              releasedBy: null,
              releasedAt: null,
              createdAt: "2099-01-01T00:00:00.000Z",
            },
          ],
        }),
      "DELETE /api/legal-holds": () =>
        json(
          { error: { code: "internal_error", message: "Server error" } },
          500
        ),
    })
    renderWithProviders(<LegalHoldsPanel gating={OWNER} />)
    await user.click(
      await screen.findByRole("button", {
        name: "Release hold on review 00000000-0000-4000-8000-0000000000bb",
      })
    )
    const confirm = await screen.findByRole("alertdialog")
    // The consequence stays spelled out on the destructive confirmation.
    expect(
      within(confirm).getByText(/next daily retention run may redact/)
    ).toBeInTheDocument()
    await user.click(
      within(confirm).getByRole("button", { name: "Release hold" })
    )
    expect(
      await within(confirm).findByText(/The hold wasn’t released/)
    ).toBeInTheDocument()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("draws each privacy area as a titled settings section", async () => {
    stubFetch({
      "GET /api/privacy/requests": () => json({ requests: [] }),
      "GET /api/legal-holds": () => json({ holds: [] }),
      "GET /api/privacy/retention-status": () =>
        json({
          lastCompletedCycle: null,
          currentCycle: null,
          rawContentRetentionDays: 1,
          deletesEnabled: true,
          heldReviews: 0,
          heldLocations: 0,
        }),
    })
    renderWithProviders(<PrivacySettings access="manage" />)
    for (const name of [
      "Privacy requests",
      "Export a subject’s records",
      "Legal holds",
      "Retention",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument()
    }
    // Retention facts are a description list (label, then value).
    expect(await screen.findByText("1 day")).toBeInTheDocument()
    expect(screen.getByText("Raw review content kept for").tagName).toBe("DT")
  })
})
