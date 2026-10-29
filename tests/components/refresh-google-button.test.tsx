import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { refreshResultToast } from "@/components/performance/refresh-google-button"
import { ReportActionsMenu } from "@/components/reporting/report-actions-menu"
import { Toaster } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The tab's figures, as a mounted (so active) query the refresh re-reads. */
function Figures({ load }: { load: () => Promise<unknown> }) {
  useQuery({
    queryKey: queryKeys.analytics("presence", { range: "28d" }),
    queryFn: load,
  })
  return null
}

function renderMenu(
  canTrigger: boolean,
  scopedToClient = false,
  figures?: () => Promise<unknown>
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        {figures ? <Figures load={figures} /> : null}
        <ReportActionsMenu
          refresh={canTrigger ? { kind: "performance", scopedToClient } : null}
        />
      </Toaster>
    </QueryClientProvider>
  )
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }))
}

// "Refresh from Google" lives in the report's actions menu (CLR-02); what it
// asks Google for, and what it says back, is unchanged.
describe("Refresh from Google in the report's actions menu", () => {
  it("is not in the menu, or the menu drawn at all, for a caller who cannot trigger a sync", () => {
    renderMenu(false)
    expect(
      screen.queryByRole("button", { name: "More actions" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: /refresh from google/i })
    ).not.toBeInTheDocument()
  })
  it("says it checks across clients on a report scoped to one client (D7), and keeps the same request", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            organisations: [],
            skipped: false,
            nextCursor: null,
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    renderMenu(true, true)
    await openMenu()
    expect(
      screen.queryByRole("menuitem", { name: "Refresh from Google" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: "Check for new data across clients",
      })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
  })
  it("POSTs the performance sync and says nothing was due when the server checked none", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            organisations: [],
            skipped: false,
            nextCursor: null,
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    renderMenu(true)
    await openMenu()
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /refresh from google/i })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
    // The server's own answer, not a "started" for work that already ended.
    expect(
      await screen.findByText("Nothing to refresh yet")
    ).toBeInTheDocument()
    expect(screen.queryByText("Refresh started")).not.toBeInTheDocument()
  })
  it.each([
    [
      "every listing checked",
      [{ status: "succeeded" }, { status: "succeeded" }],
      false,
      "Refreshed from Google",
      /^Checked 2 listings\. The figures shown/,
    ],
    [
      "one client's report",
      [{ status: "succeeded" }],
      true,
      "Refreshed from Google",
      /^Checked 1 listing across your clients\./,
    ],
    [
      "some failed",
      [{ status: "succeeded" }, { status: "failed" }],
      false,
      "1 of 2 listings could not be refreshed",
      /^The report says why\.$/,
    ],
  ])(
    "says what the server found: %s",
    async (_case, outcomes, scoped, title, description) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(
          async () =>
            new Response(
              JSON.stringify({
                organisations: [{ organisationId: "o1", outcomes }],
                truncated: false,
              }),
              { headers: { "content-type": "application/json" } }
            )
        )
      )
      renderMenu(true, scoped)
      await openMenu()
      await userEvent.click(
        await screen.findByRole("menuitem", {
          name: scoped
            ? "Check for new data across clients"
            : "Refresh from Google",
        })
      )
      expect(await screen.findByText(title)).toBeInTheDocument()
      expect(screen.getByText(description)).toBeInTheDocument()
    }
  )
  it("says the figures couldn’t be reloaded when Google answered but the re-read failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              organisations: [
                {
                  organisationId: "o1",
                  outcomes: [{ status: "succeeded" }, { status: "succeeded" }],
                },
              ],
              truncated: false,
            }),
            { headers: { "content-type": "application/json" } }
          )
      )
    )
    // The first load succeeds; the re-read after the sync does not, which
    // TanStack swallows rather than throwing to the caller.
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ totals: {} })
      .mockRejectedValue(new Error("reload failed"))
    renderMenu(true, false, load)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await openMenu()
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /refresh from google/i })
    )
    expect(
      await screen.findByText(
        "Checked 2 listings. The figures couldn’t be reloaded; those shown are from the last successful load."
      )
    ).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByText("Refreshed from Google")).toBeInTheDocument()
    expect(
      screen.queryByText(/The figures shown include this check/)
    ).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="toast"]')).toHaveAttribute(
      "data-type",
      "warning"
    )
  })
  it("says only that it started when the server cut the sync short", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              organisations: [
                { organisationId: "o1", outcomes: [{ status: "succeeded" }] },
              ],
              truncated: true,
            }),
            { headers: { "content-type": "application/json" } }
          )
      )
    )
    renderMenu(true)
    await openMenu()
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /refresh from google/i })
    )
    expect(await screen.findByText("Refresh started")).toBeInTheDocument()
  })
  it("says why a refresh could not start, beside the menu button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ error: "sync_in_progress", message: "busy" }),
            { status: 409, headers: { "content-type": "application/json" } }
          )
      )
    )
    renderMenu(true)
    await openMenu()
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /refresh from google/i })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already running/
    )
  })
})

describe("refreshResultToast at the per-request listing cap", () => {
  const outcomes = (count: number) =>
    Array.from({ length: count }, () => ({ status: "succeeded" as const }))

  it.each([
    ["performance", 25],
    ["keywords", 10],
  ] as const)(
    "treats a %s walk that reached %i listings as only started",
    (kind, cap) => {
      // The server stops at its cap without setting `truncated`, so a full
      // count does not prove nothing is left.
      expect(
        refreshResultToast(
          { organisations: [{ outcomes: outcomes(cap) }], truncated: false },
          { kind }
        )
      ).toBeNull()
      expect(
        refreshResultToast(
          {
            organisations: [{ outcomes: outcomes(cap - 1) }],
            truncated: false,
          },
          { kind }
        )
      ).toMatchObject({ type: "success", title: "Refreshed from Google" })
    }
  )
})
