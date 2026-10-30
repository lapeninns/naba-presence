import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewLinkTab } from "@/components/listings/review-link-tab"
import { Toaster } from "@/components/ui/toast"
import type {
  ReviewLink,
  ReviewLinkState,
  ReviewLinkStats,
} from "@/lib/domain/review-link-contract"

// The area's data hooks, one mock each. Every write answers with the whole
// state, so a mutation's onSuccess is handed one when a test wants it to land.
const useReviewLinkMock = vi.hoisted(() => vi.fn())
const useReviewLinkStatsMock = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))
const update = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))
const check = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }))
vi.mock("@/components/listings/review-link-queries", () => ({
  useReviewLink: (...args: unknown[]) => useReviewLinkMock(...args),
  useReviewLinkStats: (...args: unknown[]) => useReviewLinkStatsMock(...args),
  useCreateReviewLink: () => create,
  useUpdateReviewLink: () => update,
  useCheckGoogleForReviewForm: () => check,
}))

// The real encoder by default; one case makes it refuse, to test the
// placeholder a code that can't be drawn gets.
const encoderRefuses = vi.hoisted(() => ({ value: false }))
vi.mock("@/lib/domain/review-link-qr", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/domain/review-link-qr")>()
  return {
    ...actual,
    encodeQr: (text: string) =>
      encoderRefuses.value ? null : actual.encodeQr(text),
  }
})

const LOCATION = "loc-1"
const TARGET = "https://g.page/r/abc/review"

function makeLink(overrides: Partial<ReviewLink> = {}): ReviewLink {
  return {
    id: "link-1",
    code: "abcdefghjk",
    url: "https://app.test/r/abcdefghjk",
    qrUrl: "https://app.test/r/abcdefghjk?s=qr",
    caption: null,
    targetUri: TARGET,
    status: "live",
    createdAt: "2026-10-01T09:00:00.000Z",
    rotatedAt: null,
    disabledAt: null,
    ...overrides,
  }
}

function makeState(overrides: Partial<ReviewLinkState> = {}): ReviewLinkState {
  return {
    link: makeLink(),
    googleTarget: TARGET,
    targetChanged: false,
    canManage: true,
    ...overrides,
  }
}

function makeStats(
  totals: ReviewLinkStats["totals"],
  days: 30 | 90 = 30
): ReviewLinkStats {
  return {
    days,
    timeZone: "Europe/London",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    series: [
      { date: "2026-10-01", clicks: 0, qrClicks: 0, newReviews: 0 },
      {
        date: "2026-10-02",
        clicks: Math.floor(totals.clicks / 2),
        qrClicks: Math.floor(totals.qrClicks / 2),
        newReviews: Math.floor(totals.newReviews / 2),
      },
      {
        date: "2026-10-03",
        clicks: totals.clicks - Math.floor(totals.clicks / 2),
        qrClicks: totals.qrClicks - Math.floor(totals.qrClicks / 2),
        newReviews: totals.newReviews - Math.floor(totals.newReviews / 2),
      },
    ],
    totals,
  }
}

function loaded(data: ReviewLinkState) {
  useReviewLinkMock.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
}

function statsLoaded(totals = { clicks: 12, qrClicks: 5, newReviews: 3 }) {
  useReviewLinkStatsMock.mockImplementation(
    (_location: string, days: 30 | 90) => ({
      data: makeStats(totals, days),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  )
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ReviewLinkTab locationId={LOCATION} />
      </Toaster>
    </QueryClientProvider>
  )
}

/** Disabled the native way or, for a button that stays focusable, by aria. */
function expectBlocked(element: HTMLElement) {
  expect(
    element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true"
  ).toBe(true)
}

/** Answers a write as the server would: with the whole new state. */
function succeedWith(next: ReviewLinkState) {
  return (
    _input: unknown,
    options?: { onSuccess?: (state: ReviewLinkState) => void }
  ) => options?.onSuccess?.(next)
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("ReviewLinkTab: loading and failure", () => {
  it("shows a loading state while the link's state is pending", () => {
    useReviewLinkMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    renderTab()
    expect(screen.getByText("Loading the review link…")).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Your review link" })
    ).not.toBeInTheDocument()
  })

  it("says the section couldn’t load and tries again on request", async () => {
    const refetch = vi.fn()
    useReviewLinkMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("boom"),
      refetch,
    })
    renderTab()
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("We couldn’t load this section")
    await userEvent.click(
      within(alert).getByRole("button", { name: "Try again" })
    )
    expect(refetch).toHaveBeenCalledOnce()
  })
})

describe("ReviewLinkTab: no link yet", () => {
  it("asks Google again when it hasn’t given a review form", async () => {
    loaded(makeState({ link: null, googleTarget: null }))
    renderTab()
    expect(
      screen.getByRole("heading", {
        name: "Google hasn’t given a review link yet",
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Create review link" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Check Google now" })
    )
    expect(check.mutate).toHaveBeenCalledOnce()
  })

  it("creates the link for someone who can manage it", async () => {
    loaded(makeState({ link: null }))
    renderTab()
    expect(
      screen.getByRole("heading", { name: "No review link yet" })
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Create review link" })
    )
    expect(create.mutate).toHaveBeenCalledOnce()
    expect(create.mutate.mock.calls[0]![0]).toEqual({})
  })

  it("says who can create one, with no button, for someone who can’t", () => {
    loaded(makeState({ link: null, canManage: false }))
    renderTab()
    expect(
      screen.queryByRole("button", { name: "Create review link" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Someone who can edit this listing can create one.")
    ).toBeInTheDocument()
  })
})

describe("ReviewLinkTab: a live link", () => {
  it("shows the link read-only, marked Live, and copies it", async () => {
    loaded(makeState())
    statsLoaded()
    const user = userEvent.setup()
    // user-event installs its own clipboard on setup: replace it after.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderTab()
    expect(
      screen.getByRole("heading", { name: "Your review link" })
    ).toBeInTheDocument()
    expect(screen.getByText("Live")).toBeInTheDocument()
    const field = screen.getByRole("textbox", { name: "Link" })
    expect(field).toHaveValue("https://app.test/r/abcdefghjk")
    expect(field).toHaveAttribute("readonly")

    await user.click(screen.getByRole("button", { name: "Copy link" }))
    expect(writeText).toHaveBeenCalledWith("https://app.test/r/abcdefghjk")
    expect(
      await screen.findByRole("button", { name: "Copied" })
    ).toBeInTheDocument()
  })

  it("warns that printed codes stop working before making a new link", async () => {
    loaded(makeState())
    statsLoaded()
    update.mutate.mockImplementation(
      succeedWith(makeState({ link: makeLink({ code: "zzzzzzzzzz" }) }))
    )
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Make a new link" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(
      /every printed QR code stop working straight away/
    )
    expect(update.mutate).not.toHaveBeenCalled()
    await user.click(
      within(dialog).getByRole("button", { name: "Make a new link" })
    )
    expect(update.mutate).toHaveBeenCalledOnce()
    expect(update.mutate.mock.calls[0]![0]).toEqual({ action: "rotate" })
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
  })

  it("asks before switching the link off", async () => {
    loaded(makeState())
    statsLoaded()
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Switch off" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Switch off this link?")
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Switch off" }))
    expect(update.mutate).toHaveBeenCalledOnce()
    expect(update.mutate.mock.calls[0]![0]).toEqual({ action: "disable" })
  })

  it("points the link at Google’s new address on request", async () => {
    loaded(makeState({ targetChanged: true }))
    statsLoaded()
    renderTab()
    expect(
      screen.getByText("Google has a new address for the review form")
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Use the new address" })
    )
    expect(update.mutate.mock.calls[0]![0]).toEqual({ action: "sync_target" })
  })

  it("offers nothing to change Google’s new address to someone who can’t manage", () => {
    loaded(makeState({ targetChanged: true, canManage: false }))
    statsLoaded()
    renderTab()
    expect(
      screen.queryByRole("button", { name: "Use the new address" })
    ).not.toBeInTheDocument()
  })

  it("shows the link and its copy button, and nothing to change, to someone who can’t manage", () => {
    loaded(makeState({ canManage: false }))
    statsLoaded()
    renderTab()
    expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue(
      "https://app.test/r/abcdefghjk"
    )
    expect(
      screen.getByRole("button", { name: "Copy link" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Make a new link" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Switch off" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: /Caption under the code/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Caption: “Leave us a review on Google”")
    ).toBeInTheDocument()
  })
})

describe("ReviewLinkTab: a switched-off link", () => {
  it("is marked Switched off and switches back on", async () => {
    loaded(makeState({ link: makeLink({ status: "off" }) }))
    statsLoaded()
    renderTab()
    expect(screen.getByText("Switched off")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Switch off" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Switch back on" })
    )
    expect(update.mutate).toHaveBeenCalledOnce()
    expect(update.mutate.mock.calls[0]![0]).toEqual({ action: "enable" })
  })
})

describe("ReviewLinkTab: caption", () => {
  it("refuses a caption that asks for stars, and never saves it", async () => {
    loaded(makeState())
    statsLoaded()
    const user = userEvent.setup()
    renderTab()
    const caption = screen.getByRole("textbox", {
      name: /Caption under the code/,
    })
    await user.type(caption, "Rate us 5 stars")
    expect(
      await screen.findByText(/This asks for a rating/)
    ).toBeInTheDocument()
    expect(caption).toHaveAttribute("aria-invalid", "true")
    const save = screen.getByRole("button", { name: "Save caption" })
    expectBlocked(save)
    await user.click(save)
    await user.type(caption, "{Enter}")
    expect(update.mutate).not.toHaveBeenCalled()
  })

  it("saves an allowed caption", async () => {
    loaded(makeState())
    statsLoaded()
    update.mutate.mockImplementation(
      succeedWith(
        makeState({ link: makeLink({ caption: "Thanks for visiting" }) })
      )
    )
    const user = userEvent.setup()
    renderTab()
    const caption = screen.getByRole("textbox", {
      name: /Caption under the code/,
    })
    await user.type(caption, "Thanks for visiting")
    expect(screen.queryByText(/This asks for/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save caption" }))
    expect(update.mutate).toHaveBeenCalledOnce()
    expect(update.mutate.mock.calls[0]![0]).toEqual({
      action: "caption",
      caption: "Thanks for visiting",
    })
    expect(await screen.findByText("Caption saved")).toBeInTheDocument()
  })
})

describe("ReviewLinkTab: QR code", () => {
  it("draws the code from the QR link, with both downloads on", () => {
    loaded(makeState())
    statsLoaded()
    renderTab()
    const image = document.querySelector<HTMLImageElement>(
      '[data-slot="review-link-qr"]'
    )
    expect(image).not.toBeNull()
    expect(image!.src).toMatch(/^data:image\/svg\+xml/)
    const svg = decodeURIComponent(image!.src.split(",")[1] ?? "")
    expect(svg).toContain("<rect")
    const caption = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
      .map((line) => line[1])
      .join(" ")
    expect(caption).toBe("Leave us a review on Google")
    for (const name of ["Download PNG", "Download SVG"]) {
      expect(screen.getByRole("button", { name })).not.toBeDisabled()
    }
  })

  it("says why there is no code when the link is off", () => {
    loaded(makeState({ link: makeLink({ status: "off" }) }))
    statsLoaded()
    renderTab()
    expect(screen.getByText("The link is switched off")).toBeVisible()
    expect(document.querySelector('[data-slot="review-link-qr"]')).toBeNull()
    expectBlocked(screen.getByRole("button", { name: "Download SVG" }))
  })

  it("says so and keeps the downloads off when the code can't be drawn", () => {
    encoderRefuses.value = true
    try {
      loaded(makeState())
      statsLoaded()
      renderTab()
      const placeholder = document.querySelector<HTMLElement>(
        '[data-slot="review-link-qr-placeholder"]'
      )
      expect(placeholder).not.toBeNull()
      expect(
        within(placeholder!).getByText("Couldn’t draw the QR code.")
      ).toBeVisible()
      for (const name of ["Download PNG", "Download SVG"]) {
        const button = screen.getByRole("button", { name })
        expectBlocked(button)
        expect(button).toHaveAccessibleDescription("Couldn’t draw the QR code.")
      }
    } finally {
      encoderRefuses.value = false
    }
  })
})

describe("ReviewLinkTab: stats", () => {
  function kpi(label: string) {
    const tile = screen
      .getAllByText(label, { exact: true })
      .map((node) => node.closest('[data-slot="kpi-tile"]'))
      .find(Boolean)
    expect(tile, `KPI tile ${label}`).toBeTruthy()
    return tile as HTMLElement
  }

  it("shows opens, QR scans and new reviews for the period", () => {
    loaded(makeState())
    statsLoaded({ clicks: 12, qrClicks: 5, newReviews: 3 })
    renderTab()
    expect(
      screen.getByRole("heading", { name: "Opens and new reviews" })
    ).toBeInTheDocument()
    expect(kpi("Link opens")).toHaveTextContent("12")
    expect(kpi("From the QR code")).toHaveTextContent("5")
    expect(kpi("New reviews")).toHaveTextContent("3")
    expect(
      screen.queryByText("No opens or new reviews in this period.")
    ).not.toBeInTheDocument()
    expect(useReviewLinkStatsMock).toHaveBeenCalledWith(LOCATION, 30)
  })

  it("says so when nothing happened in the period", () => {
    loaded(makeState())
    statsLoaded({ clicks: 0, qrClicks: 0, newReviews: 0 })
    renderTab()
    expect(
      screen.getByText("No opens or new reviews in this period.")
    ).toBeInTheDocument()
  })

  it("reads 90 days when 90 days is picked", async () => {
    loaded(makeState())
    statsLoaded()
    renderTab()
    await userEvent.click(screen.getByRole("tab", { name: "90 days" }))
    await waitFor(() =>
      expect(useReviewLinkStatsMock).toHaveBeenLastCalledWith(LOCATION, 90)
    )
  })
})
