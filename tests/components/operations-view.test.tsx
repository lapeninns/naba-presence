import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { OperationsView } from "@/components/settings/operations-view"
import { ScheduledJobsDisclosure } from "@/components/settings/scheduled-jobs-panel"
import {
  operationsHealthSchema,
  schedulerTickSchema,
  type SchedulerTick,
} from "@/lib/contracts/operations"
import {
  describeSchedule,
  formatInterval,
  formatSpan,
  humaniseJobKey,
  isTickStale,
  SCHEDULED_JOBS,
  scheduledJobInfo,
  summariseScheduler,
} from "@/lib/operations/job-labels"
import { formatZonedTime, usableZone } from "@/lib/operations/zoned-time"
import { queryKeys } from "@/lib/queries/keys"
import { Toaster } from "@/components/ui/toast"

const api = vi.hoisted(() => ({
  fetchOperationsHealth: vi.fn(),
  fetchWebhookFailures: vi.fn(),
  replayWebhookEvent: vi.fn(),
  retryNotificationDeliveries: vi.fn(),
}))
vi.mock("@/lib/api/operations", () => api)

const settingsApi = vi.hoisted(() => ({ fetchSettings: vi.fn() }))
vi.mock("@/lib/api/settings", () => settingsApi)

function orgZone(defaultTimezone: string) {
  settingsApi.fetchSettings.mockResolvedValue({
    approvalRequired: true,
    requireTwoPersonApproval: false,
    rawContentRetentionDays: 30,
    defaultLanguageCode: "en-GB",
    defaultTimezone,
    directPublishConsentAt: null,
  })
}

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const tick = (
  name: string,
  minutes: number | null,
  staleAfterSeconds: number,
  stale = false,
  paused = false
): SchedulerTick =>
  // The run ledger fields (0089) take their defaults.
  schedulerTickSchema.parse({
    name,
    lastCompletedAt: minutes === null ? null : minutesAgo(minutes),
    staleAfterSeconds,
    stale,
    paused,
  })

function health(schedulerTicks: SchedulerTick[]) {
  return operationsHealthSchema.parse({
    generatedAt: new Date().toISOString(),
    sync: {},
    webhooks: {},
    connections: [],
    publish24h: [],
    replyRejections30d: [],
    providerTotalDivergence30d: 0,
    failedWebhookEvents: 0,
    deadWebhookEvents: 0,
    oldestFailedEventAgeSeconds: null,
    ambiguousPublishAttempts: 0,
    staleStartedAttempts: 0,
    dueJobBacklog: 0,
    checkpointFailures24h: 0,
    connectionErrors24h: 0,
    schedulerHeartbeatAt: minutesAgo(1),
    schedulerTicks,
  })
}

beforeEach(() => {
  orgZone("Pacific/Auckland")
})

afterEach(() => {
  vi.clearAllMocks()
})

// The server's own thresholds (lib/server/ops-liveness.ts), which the page
// renders rather than re-deciding.
const STALE_AFTER: Record<string, number> = {
  jobs: 300,
  reconcile: 2_700,
  "presence-resources": 2_700,
  performance: 64_800,
  health: 2_700,
  retention: 172_800,
  keywords: 172_800,
  sweep: 172_800,
}

describe("OperationsView scheduler rows", () => {
  it("names every job, explains it, and never shows an internal key", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      health(
        Object.keys(STALE_AFTER).map((name) => tick(name, 2, STALE_AFTER[name]))
      )
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)

    const list = await screen.findByRole("list", { name: "Scheduled jobs" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows).toHaveLength(8)
    for (const name of Object.keys(STALE_AFTER)) {
      const info = SCHEDULED_JOBS[name]
      expect(within(list).getByText(info.label)).toBeInTheDocument()
      expect(within(list).getByText(info.purpose)).toBeInTheDocument()
    }
    expect(within(list).getByText("Listing sync")).toBeInTheDocument()
    expect(
      within(list).getByText("Data retention clean-up")
    ).toBeInTheDocument()
    // The key is secondary: never a row's title or purpose, only quoted
    // under "Details for support".
    const keys = Object.keys(STALE_AFTER)
    for (const text of [
      ...list.querySelectorAll('[data-slot="list-row-title"]'),
      ...list.querySelectorAll('[data-slot="list-row-subtitle"]'),
    ].map((element) => element.textContent)) {
      expect(keys).not.toContain(text)
    }
    for (const row of rows) {
      const support = row.querySelector('[data-slot="support-details"]')
      expect(support).not.toBeNull()
      expect(keys).toContain(support!.querySelector("code")!.textContent)
    }
  })

  it("marks overdue jobs against each job's own schedule and says why", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      health([
        // The 375px report: 16 minutes is stale for a one-minute tick…
        tick("jobs", 16, 300, true),
        // …while 19 and 38 minutes are inside a 15-minute tick's 45-minute window.
        tick("reconcile", 19, 2_700),
        tick("presence-resources", 38, 2_700),
        tick("health", null, 2_700, true),
      ])
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)

    const list = await screen.findByRole("list", { name: "Scheduled jobs" })
    const row = (label: string) =>
      within(list).getByText(label).closest("li") as HTMLElement

    const jobs = row("Work queue")
    expect(within(jobs).getByText("Overdue")).toBeInTheDocument()
    expect(
      within(jobs).getByText("Last run 16 minutes ago")
    ).toBeInTheDocument()
    expect(
      within(jobs).getByText(
        "Expected every minute · overdue after 5 minutes without a run"
      )
    ).toBeInTheDocument()

    for (const [label, age] of [
      ["Review check", 19],
      ["Listing sync", 38],
    ] as const) {
      const r = row(label)
      expect(within(r).getByText("On schedule")).toBeInTheDocument()
      expect(within(r).queryByText("Overdue")).toBeNull()
      expect(
        within(r).getByText(`Last run ${age} minutes ago`)
      ).toBeInTheDocument()
      expect(
        within(r).getByText(
          "Expected every 15 minutes · overdue after 45 minutes without a run"
        )
      ).toBeInTheDocument()
    }

    const healthRow = row("Health checks")
    expect(within(healthRow).getByText("Overdue")).toBeInTheDocument()
    expect(within(healthRow).getByText("Never completed")).toBeInTheDocument()
  })

  it("marks a row stale once its window passes even if the payload predates it", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      health([tick("presence-resources", 50, 2_700, false)])
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    const list = await screen.findByRole("list", { name: "Scheduled jobs" })
    expect(within(list).getByText("Overdue")).toBeInTheDocument()
  })

  it("humanises an unknown job key", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      health([tick("gbp_media-refresh", 1, 600)])
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    const list = await screen.findByRole("list", { name: "Scheduled jobs" })
    expect(within(list).getByText("Gbp media refresh")).toBeInTheDocument()
    expect(
      within(list).getByText("Overdue after 10 minutes without a run")
    ).toBeInTheDocument()
  })
})

describe("OperationsView summary", () => {
  const load = async (ticks: SchedulerTick[], heartbeatStale = false) => {
    api.fetchOperationsHealth.mockResolvedValue({
      ...health(ticks),
      schedulerHeartbeatStale: heartbeatStale,
    })
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    await screen.findByRole("list", { name: "Scheduled jobs" })
    return document.querySelector('[data-slot="alert"]') as HTMLElement
  }

  it("says all is well in one line and keeps the details closed", async () => {
    const alert = await load([
      tick("jobs", 1, 300),
      tick("reconcile", 5, 2_700),
    ])
    expect(alert).toHaveAttribute("data-state", "ok")
    expect(alert).toHaveTextContent("Background jobs are running on schedule.")
    expect(
      document.querySelector("details[data-slot=scheduled-jobs]")
    ).not.toHaveAttribute("open")
  })

  it("says what is out of date and what to do when some jobs are overdue, and opens the details", async () => {
    const alert = await load([
      tick("jobs", 1, 300),
      tick("reconcile", 100, 2_700, true),
      tick("presence-resources", 100, 2_700, true),
    ])
    expect(alert).toHaveAttribute("data-state", "some-stale")
    expect(alert).toHaveTextContent(
      "2 background jobs haven't run recently. This may delay review updates and listing updates from Google; they should catch up on the next run. Contact support if this lasts more than a day."
    )
    expect(
      document.querySelector("details[data-slot=scheduled-jobs]")
    ).toHaveAttribute("open")
    expect(screen.getByText("(3, 2 overdue)")).toBeInTheDocument()
  })

  it("says background work is not running when the scheduler stops reporting", async () => {
    const alert = await load([tick("jobs", 1, 300)], true)
    expect(alert).toHaveAttribute("data-state", "failing")
    expect(alert).toHaveTextContent(
      "Background work isn't running. New reviews, listing updates and reply publishing won't be processed until it starts again. Contact support."
    )
    expect(screen.getByText("Not reporting")).toBeInTheDocument()
  })

  it("shows a paused job as Paused, not Overdue, with a neutral note", async () => {
    const alert = await load([
      tick("jobs", 1, 300),
      tick("billing-reconcile", null, 7_200, true, true),
    ])
    expect(alert).toHaveAttribute("data-state", "paused")
    expect(alert).toHaveTextContent("Paused: Billing check.")
    const row = screen.getByText("Billing check").closest("li") as HTMLElement
    expect(within(row).getByText("Paused")).toBeInTheDocument()
    expect(within(row).queryByText("Overdue")).toBeNull()
    expect(
      document.querySelector("details[data-slot=scheduled-jobs]")
    ).not.toHaveAttribute("open")
  })

  it("treats every job overdue as failing", async () => {
    const alert = await load([
      tick("jobs", null, 300, true),
      tick("health", null, 2_700, true),
    ])
    expect(alert).toHaveAttribute("data-state", "failing")
  })
})

describe("ScheduledJobsDisclosure", () => {
  const now = new Date()
  const detailsOf = () =>
    document.querySelector(
      "details[data-slot=scheduled-jobs]"
    ) as HTMLDetailsElement

  it("follows the state until the person chooses, and then keeps their choice", async () => {
    const user = userEvent.setup()
    const overdue = [tick("jobs", 99, 300, true)]
    const fine = [tick("jobs", 1, 300)]
    const view = (ticks: SchedulerTick[]) => (
      <ScheduledJobsDisclosure
        ticks={ticks}
        summary={summariseScheduler(ticks, false, now)}
        timeZone="Pacific/Auckland"
        now={now}
      />
    )
    const { rerender } = render(view(overdue))
    // Opened by the state, not by anyone: that must not count as a choice,
    // so it closes again when the jobs recover.
    await waitFor(() => expect(detailsOf().open).toBe(true))
    rerender(view(fine))
    await waitFor(() => expect(detailsOf().open).toBe(false))
    // A press is a choice and survives the next refresh.
    await user.click(screen.getByText("Details for each job"))
    await waitFor(() => expect(detailsOf().open).toBe(true))
    rerender(view(overdue))
    rerender(view(fine))
    expect(detailsOf().open).toBe(true)
  })
})

describe("summariseScheduler", () => {
  const now = new Date("2026-10-15T12:00:00Z")
  const ago = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString()
  const t = (name: string, minutes: number | null, after = 2_700) => ({
    name,
    lastCompletedAt: minutes === null ? null : ago(minutes),
    staleAfterSeconds: after,
    stale: false,
  })

  it("is ok with no overdue job", () => {
    expect(summariseScheduler([t("jobs", 1, 300)], false, now)).toMatchObject({
      state: "ok",
      overdue: 0,
      total: 1,
    })
  })

  it("names at most three affected areas and counts the rest", () => {
    const summary = summariseScheduler(
      [
        t("jobs", 99, 300),
        t("reconcile", 99),
        t("presence-resources", 99),
        t("billing-reconcile", 99, 300),
        t("health", 1),
      ],
      false,
      now
    )
    expect(summary.state).toBe("some-stale")
    expect(summary.message).toContain(
      "This may delay queued syncs and reply publishing, review updates, listing updates from Google and 1 more;"
    )
  })

  it("does not guess for an unknown overdue job", () => {
    const summary = summariseScheduler(
      [t("mystery_tick", 99, 300), t("jobs", 1, 300)],
      false,
      now
    )
    expect(summary.message).toBe(
      "1 background job hasn't run recently. This may delay some updates; it should catch up on the next run. Contact support if this lasts more than a day."
    )
  })

  it("leaves paused jobs out of overdue and failing, and names them", () => {
    const paused = (name: string, minutes: number | null, after: number) => ({
      ...t(name, minutes, after),
      paused: true,
    })
    // Some paused, the rest on schedule: neutral, never overdue.
    const some = summariseScheduler(
      [t("jobs", 1, 300), paused("billing-reconcile", null, 7_200)],
      false,
      now
    )
    expect(some).toMatchObject({ state: "paused", overdue: 0, paused: 1 })
    expect(some.message).toBe(
      "Paused: Billing check. It was paused deliberately and resumes automatically when switched back on."
    )
    // All paused: not failing, even though none has run.
    const all = summariseScheduler(
      [paused("jobs", null, 300), paused("health", 999, 2_700)],
      false,
      now
    )
    expect(all).toMatchObject({ state: "paused", overdue: 0, paused: 2 })
    expect(all.message).toBe(
      "Paused: Work queue and Health checks. They were paused deliberately and resume automatically when switched back on."
    )
    // Paused plus overdue: the overdue jobs are the problem; the pause is a note.
    const mix = summariseScheduler(
      [
        t("jobs", 1, 300),
        t("reconcile", 99),
        paused("billing-reconcile", null, 7_200),
      ],
      false,
      now
    )
    expect(mix).toMatchObject({ state: "some-stale", overdue: 1, paused: 1 })
    expect(mix.message).toContain("1 background job hasn't run recently.")
    expect(mix.message).toContain("Paused: Billing check.")
    // Every running job overdue is failing, with the paused one as a note.
    const failing = summariseScheduler(
      [t("jobs", 99, 300), paused("health", null, 2_700)],
      false,
      now
    )
    expect(failing.state).toBe("failing")
    expect(failing.message).toContain("Paused: Health checks.")
  })

  it("is failing when the heartbeat is stale or every job is overdue", () => {
    expect(summariseScheduler([t("jobs", 1, 300)], true, now).state).toBe(
      "failing"
    )
    expect(summariseScheduler([t("jobs", 99, 300)], false, now).state).toBe(
      "failing"
    )
    expect(summariseScheduler([], true, now).state).toBe("failing")
    expect(summariseScheduler([], false, now).state).toBe("ok")
  })
})

describe("time zone", () => {
  it("writes a time in the organisation's zone and names it", () => {
    // 01:30 UTC on 15 Oct is 14:30 in Auckland (UTC+13) and 02:30 in London (BST).
    const iso = "2026-10-15T01:30:00Z"
    expect(formatZonedTime(iso, "Pacific/Auckland")).toBe(
      "15 Oct, 14:30 (New Zealand time)"
    )
    expect(formatZonedTime(iso, "Europe/London")).toBe(
      "15 Oct, 02:30 (UK time)"
    )
  })

  it("says the visible relative phrase when there is no usable zone", () => {
    const iso = "2026-10-15T11:55:00Z"
    const now = new Date("2026-10-15T12:00:00Z")
    expect(formatZonedTime(iso, null, now)).toBe("5 minutes ago")
    expect(formatZonedTime(iso, "Not/AZone", now)).toBe("5 minutes ago")
    expect(usableZone("Not/AZone")).toBeUndefined()
    expect(usableZone("Pacific/Auckland")).toBe("Pacific/Auckland")
  })

  it("names the Replay button with the organisation's zone, not London", async () => {
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures.mockResolvedValue({
      items: [
        {
          id: "evt-1",
          eventType: "NEW_REVIEW",
          status: "failed",
          retryCount: 1,
          nextAttemptAt: null,
          lastErrorCode: "sync_failed",
          receivedAt: "2026-10-15T01:30:00Z",
        },
      ],
    })
    renderWithProviders(<OperationsView />)
    expect(
      await screen.findByRole("button", {
        name: "Replay New reviews received 15 Oct, 14:30 (New Zealand time)",
      })
    ).toBeInTheDocument()
    // The raw type and code are for support, not the visible sentence.
    expect(
      screen.getByText(/New reviews · Failed · received/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/NEW_REVIEW ·/)).toBeNull()
    expect(
      screen.getByText(
        "The update from Google could not be processed. Replaying it queues it for the next sync run."
      )
    ).toBeInTheDocument()
  })
})

describe("OperationsView attention, figures and recovery", () => {
  const failedEvent = (overrides: Record<string, unknown> = {}) => ({
    id: "evt-1",
    eventType: "NEW_REVIEW",
    status: "failed",
    retryCount: 1,
    nextAttemptAt: null,
    lastErrorCode: "sync_failed",
    receivedAt: "2026-10-15T01:30:00Z",
    ...overrides,
  })
  const withHealth = (overrides: Record<string, unknown>) =>
    operationsHealthSchema.parse({ ...health([]), ...overrides })

  it("lists what needs attention under the summary, only counts above 0", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      withHealth({
        sync: { failed: 2 },
        notificationDeliveries: {
          queued: 0,
          oldestQueuedAt: null,
          states7d: [],
          retryable: 1,
        },
      })
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [failedEvent()] })
    renderWithProviders(<OperationsView />)
    const list = await screen.findByRole("list", { name: "Needs attention" })
    await waitFor(() =>
      expect(
        within(list).getByRole("link", {
          name: /Review events that failed to process/,
        })
      ).toHaveAttribute("href", "#ops-webhooks")
    )
    expect(
      within(list).getByRole("link", { name: /Syncs that failed/ })
    ).toHaveAttribute("href", "#ops-sync")
    expect(
      within(list).getByRole("link", { name: /Failed emails you can retry/ })
    ).toHaveAttribute("href", "#ops-email")
    expect(within(list).getAllByRole("link")).toHaveLength(3)
    expect(within(list).queryByText(/Google sign-ins/)).toBeNull()
  })

  it("draws no attention list when nothing needs it", async () => {
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    await screen.findByText("No failed events.")
    expect(screen.queryByRole("list", { name: "Needs attention" })).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Needs attention" })
    ).toBeNull()
  })

  it("names figures plainly and never shows 0 h", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      withHealth({ reconcileStalenessSeconds: 900 })
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    expect(await screen.findByText("Under 1 hour")).toBeInTheDocument()
    expect(screen.getByText("Longest since a review check")).toBeInTheDocument()
    expect(screen.getByText("Data refreshes waiting")).toBeInTheDocument()
    expect(screen.queryByText(/0 h/)).toBeNull()
    expect(screen.queryByText(/checkpoints/i)).toBeNull()
  })

  it("rounds a longer review-check gap to whole hours in words", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      withHealth({ reconcileStalenessSeconds: 3 * 3600 + 600 })
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    expect(await screen.findByText("3 hours")).toBeInTheDocument()
  })

  it("says why Retry is unavailable and orders email states good to bad", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      withHealth({
        notificationDeliveries: {
          queued: 1,
          oldestQueuedAt: null,
          states7d: [
            { state: "bounced", count: 1 },
            { state: "accepted", count: 3 },
            { state: "unknown", count: 1 },
            { state: "delivered", count: 2 },
          ],
          retryable: 0,
        },
      })
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    const button = await screen.findByRole("button", {
      name: /Retry .*failed email/,
    })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      /^No failed emails to retry\. Unknown outcomes/
    )
    expect(screen.getByText("Waiting to send now")).toBeInTheDocument()
    const labels = Array.from(
      document.querySelectorAll("section[aria-labelledby=ops-email] dt")
    ).map((node) => node.textContent)
    expect(labels).toEqual([
      "Waiting to send now",
      "Oldest waiting",
      "Accepted by provider (7 days)",
      "Delivered to mail server (7 days)",
      "Bounced (7 days)",
      "Outcome unknown (7 days)",
    ])
  })

  // What the replay leaves on the row (app/api/webhooks/google/pubsub/replay):
  // retry count and error cleared, due now.
  const afterReplay = () =>
    failedEvent({
      retryCount: 0,
      lastErrorCode: null,
      nextAttemptAt: new Date().toISOString(),
    })

  it("says a replayed event is queued and rests its button, only after the server accepts", async () => {
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures
      .mockResolvedValueOnce({ items: [failedEvent()] })
      .mockResolvedValue({ items: [afterReplay()] })
    api.replayWebhookEvent.mockResolvedValue({ status: "scheduled" })
    renderWithProviders(<OperationsView />)
    const button = await screen.findByRole("button", { name: /^Replay New/ })
    expect(screen.queryByText("Queued for the next sync run.")).toBeNull()
    await userEvent.click(button)
    expect(
      await screen.findByText("Queued for the next sync run.")
    ).toBeInTheDocument()
    // The refetch still lists the row (it stays "failed" until a run takes
    // it); the row keeps saying what happens next.
    await waitFor(() =>
      expect(api.fetchWebhookFailures).toHaveBeenCalledTimes(2)
    )
    const row = screen.getByRole("button", { name: /^Replay New/ })
    expect(row).toBeDisabled()
    expect(row).toHaveAccessibleDescription("Queued for the next sync run.")
    expect(screen.queryByText(/New reviews · Failed/)).toBeNull()
    // Said once, by the row's polite region: no toast repeating it.
    const said = screen.getByText("Queued for the next sync run.")
    expect(said).toHaveAttribute("aria-live", "polite")
    expect(screen.queryByText("Event queued for the next sync run.")).toBeNull()
    expect(screen.getAllByText(/queued for the next sync run/i)).toHaveLength(1)
  })

  it("offers Replay again when a later list shows the replayed event failed again", async () => {
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures
      .mockResolvedValueOnce({ items: [failedEvent()] })
      .mockResolvedValueOnce({ items: [afterReplay()] })
      // The runner tried it and failed (lib/server/jobs.ts counts it).
      .mockResolvedValue({
        items: [failedEvent({ retryCount: 1, lastErrorCode: "job_failed" })],
      })
    api.replayWebhookEvent.mockResolvedValue({ status: "scheduled" })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <OperationsView />
        </Toaster>
      </QueryClientProvider>
    )
    await userEvent.click(
      await screen.findByRole("button", { name: /^Replay New/ })
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Replay New/ })).toBeDisabled()
    )
    await waitFor(() =>
      expect(api.fetchWebhookFailures).toHaveBeenCalledTimes(2)
    )
    expect(screen.getByRole("button", { name: /^Replay New/ })).toBeDisabled()
    await act(() =>
      client.invalidateQueries({ queryKey: queryKeys.webhookFailures })
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Replay New/ })).toBeEnabled()
    )
    expect(screen.queryByText("Queued for the next sync run.")).toBeNull()
    expect(screen.getByText(/New reviews · Failed/)).toBeInTheDocument()
  })

  it("counts a full list of failed events as 100+", async () => {
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) =>
        failedEvent({ id: `evt-${index}` })
      ),
    })
    renderWithProviders(<OperationsView />)
    const list = await screen.findByRole("list", { name: "Needs attention" })
    await waitFor(() =>
      expect(
        within(list).getByRole("link", {
          name: /Review events that failed to process/,
        })
      ).toHaveTextContent("100+")
    )
  })

  it("points lost listing access at the listings and Google manager access, not reconnecting", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      withHealth({ listingsAccessLost: 2 })
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    const list = await screen.findByRole("list", { name: "Needs attention" })
    const row = within(list).getByRole("link", {
      name: /Listings Google no longer lets us reach/,
    })
    expect(row).toHaveAttribute("href", "/listings?health=attention")
    expect(row).toHaveTextContent(/restore manager access on Google/)
    expect(row).not.toHaveTextContent(/Reconnect/)
  })

  it("keeps the row as it was when the replay is refused", async () => {
    const { ApiClientError } = await import("@/lib/api/client")
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures.mockResolvedValue({ items: [failedEvent()] })
    api.replayWebhookEvent.mockRejectedValue(
      new ApiClientError(503, "sync_paused", "Review sync is paused.")
    )
    renderWithProviders(<OperationsView />)
    await userEvent.click(
      await screen.findByRole("button", { name: /^Replay New/ })
    )
    expect(
      await screen.findByText("Review sync is paused.")
    ).toBeInTheDocument()
    expect(screen.queryByText("Queued for the next sync run.")).toBeNull()
    expect(screen.getByRole("button", { name: /^Replay New/ })).toBeEnabled()
  })

  it("says a failed event with a next try is retrying by itself", async () => {
    const next = new Date(Date.now() + 10 * 60_000).toISOString()
    api.fetchOperationsHealth.mockResolvedValue(health([]))
    api.fetchWebhookFailures.mockResolvedValue({
      items: [failedEvent({ nextAttemptAt: next })],
    })
    renderWithProviders(<OperationsView />)
    expect(
      await screen.findByText(
        new RegExp(
          `New reviews · Failed · retrying automatically, next try ${formatZonedTime(next, "Pacific/Auckland").replace(/[()]/g, "\\$&")}`
        )
      )
    ).toBeInTheDocument()
  })
})

describe("job labels", () => {
  it("formats intervals and spans", () => {
    expect(formatInterval(60)).toBe("every minute")
    expect(formatInterval(900)).toBe("every 15 minutes")
    expect(formatInterval(21_600)).toBe("every 6 hours")
    expect(formatInterval(86_400)).toBe("daily")
    expect(formatSpan(300)).toBe("5 minutes")
    expect(formatSpan(64_800)).toBe("18 hours")
    expect(formatSpan(172_800)).toBe("2 days")
  })

  it("falls back for unknown keys", () => {
    expect(humaniseJobKey("presence-resources")).toBe("Presence resources")
    expect(humaniseJobKey("")).toBe("Unnamed job")
    expect(scheduledJobInfo("new_tick").intervalSeconds).toBeNull()
    expect(describeSchedule(SCHEDULED_JOBS.keywords, 172_800)).toBe(
      "Expected daily · overdue after 2 days without a run"
    )
    expect(describeSchedule(SCHEDULED_JOBS.retention, 900)).toBe(
      "Expected every 5 minutes · overdue after 15 minutes without a run"
    )
  })

  it("treats never-completed and unparseable times as stale", () => {
    const now = new Date("2026-09-30T12:00:00Z")
    const base = { staleAfterSeconds: 300, stale: false }
    expect(isTickStale({ ...base, lastCompletedAt: null }, now)).toBe(true)
    expect(isTickStale({ ...base, lastCompletedAt: "nope" }, now)).toBe(true)
    expect(
      isTickStale({ ...base, lastCompletedAt: "2026-09-30T11:58:00Z" }, now)
    ).toBe(false)
    expect(
      isTickStale({ ...base, lastCompletedAt: "2026-09-30T11:54:00Z" }, now)
    ).toBe(true)
  })
})

describe("job intervals match the deployed cron schedule", () => {
  // Path in vercel.json -> tick name in ops_heartbeat.
  const PATH_TO_JOB: Record<string, string> = {
    "/api/jobs/run": "jobs",
    "/api/sync/reconcile": "reconcile",
    "/api/sync/presence-resources": "presence-resources",
    "/api/sync/performance": "performance",
    "/api/sync/sweep": "sweep",
    "/api/sync/keywords": "keywords",
    "/api/cron/retention": "retention",
    "/api/cron/health": "health",
    "/api/billing/reconcile": "billing-reconcile",
  }

  // Covers the shapes vercel.json uses: "*", "*/n", "a,b,c" (evenly spaced)
  // and fixed minute/hour fields.
  function cronIntervalSeconds(schedule: string): number {
    const [minute, hour] = schedule.split(" ")
    const step = (field: string, span: number) => {
      if (field === "*") return 1
      if (field.startsWith("*/")) return Number(field.slice(2))
      const values = field.split(",").map(Number)
      return values.length > 1 ? values[1] - values[0] : span
    }
    if (hour === "*") return step(minute, 60) * 60
    return step(hour, 24) * 3600
  }

  it("covers every cron and agrees with its schedule", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> }
    const seen = new Set<string>()
    for (const cron of config.crons) {
      const job = PATH_TO_JOB[cron.path.split("?")[0]]
      expect(job, cron.path).toBeDefined()
      seen.add(job)
      expect(SCHEDULED_JOBS[job].intervalSeconds, job).toBe(
        cronIntervalSeconds(cron.schedule)
      )
    }
    expect([...seen].sort()).toEqual(Object.keys(SCHEDULED_JOBS).sort())
  })
})
