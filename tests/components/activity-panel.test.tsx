import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { mockWebkitShortSeptember } from "../helpers/webkit-short-month"
import { LocationActivityPanel } from "@/components/locations/activity-panel"
import { Toaster } from "@/components/ui/toast"
import type { ListPaging } from "@/lib/queries/paged-list"

const usePagesMock = vi.fn()
vi.mock("@/lib/queries/use-location-activity", () => ({
  useLocationActivityPages: (...args: unknown[]) => usePagesMock(...args),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => ({
    data: { canEditCanonical: true, canPublish: true },
    isPending: false,
    isError: false,
  }),
}))

const noMore: ListPaging = {
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  loadMore: () => {},
}

function item(id: string) {
  return {
    id: `hours:${id}`,
    resourceType: "hours",
    operation: "publish",
    status: "succeeded",
    targetResourceName: null,
    lastErrorCode: null,
    updateMask: [],
    createdAt: "2026-09-29T12:00:00Z",
    finishedAt: null,
    actorUserId: null,
    actorDisplayName: null,
  }
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <LocationActivityPanel locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("LocationActivityPanel", () => {
  it.each([
    ["2026-10-01T00:30:00Z", "30 Sept, 17:30"],
    ["2027-01-01T07:59:00Z", "31 Dec, 23:59"],
    ["invalid", "Invalid Date"],
  ])(
    "keeps activity timestamp %s local, without a year, including its invalid sentinel",
    (createdAt, expected) => {
      vi.stubEnv("TZ", "America/Los_Angeles")
      mockWebkitShortSeptember()
      usePagesMock.mockReturnValue({
        data: {
          canManage: false,
          total: 1,
          pageSize: 10,
          items: [{ ...item("a"), createdAt }],
          paging: noMore,
        },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      })
      renderPanel()
      expect(screen.getByText(expected)).toHaveAttribute("datetime", createdAt)
    }
  )

  it("loads older changes with Load more instead of numbered pages", async () => {
    const user = userEvent.setup()
    const loadMore = vi.fn()
    usePagesMock.mockReturnValue({
      data: {
        canManage: false,
        total: 12,
        pageSize: 10,
        items: Array.from({ length: 10 }, (_, index) => item(String(index))),
        paging: { ...noMore, hasMore: true, loadMore },
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    renderPanel()
    expect(usePagesMock).toHaveBeenCalledWith("loc-1", 10)
    expect(screen.getByText("Showing 10 of 12 changes")).toHaveAttribute(
      "role",
      "status"
    )
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Load more changes" }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it("shows one empty state, with no Load more, when a page has no rows", () => {
    for (const total of [0, 3]) {
      usePagesMock.mockReturnValue({
        data: {
          canManage: false,
          total,
          pageSize: 10,
          items: [],
          paging: noMore,
        },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      })
      const { unmount } = renderPanel()
      expect(
        screen.getByText(
          "No changes to Google have been recorded for this listing yet."
        )
      ).toBeVisible()
      expect(screen.queryByRole("list", { name: "Recent changes" })).toBeNull()
      expect(
        screen.queryByRole("button", { name: "Load more changes" })
      ).toBeNull()
      unmount()
    }
  })

  it("says when the whole history is shown", () => {
    usePagesMock.mockReturnValue({
      data: {
        canManage: false,
        total: 2,
        pageSize: 10,
        items: [item("a"), item("b")],
        paging: noMore,
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    renderPanel()
    expect(screen.getByText("Showing all 2 changes")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull()
  })
  it("reads each row in words: operation, area, fields and failure", () => {
    usePagesMock.mockReturnValue({
      data: {
        canManage: false,
        total: 2,
        pageSize: 10,
        paging: noMore,
        items: [
          {
            ...item("a"),
            resourceType: "business_info",
            operation: "patch",
            updateMask: ["regularHours", "title"],
            status: "failed",
            lastErrorCode: "target_changed",
          },
          {
            ...item("b"),
            resourceType: "someNewArea",
            operation: "publish_google",
            status: "ambiguous",
          },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    renderPanel()
    expect(screen.getByText("Updated · Business profile")).toBeInTheDocument()
    expect(screen.getByText(/Regular hours, Business name/)).toBeInTheDocument()
    expect(
      screen.getByText(/Google’s version changed before this was sent/)
    ).toBeInTheDocument()
    expect(
      screen.getByText("Sent to Google · Other change")
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Regularhours|Publish google|Not found/)
    ).toBeNull()
  })
})
