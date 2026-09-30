import { screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { OperationsView } from "@/components/settings/operations-view"
import {
  operationsHealthSchema,
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
} from "@/lib/operations/job-labels"

const api = vi.hoisted(() => ({
  fetchOperationsHealth: vi.fn(),
  fetchWebhookFailures: vi.fn(),
  replayWebhookEvent: vi.fn(),
  retryNotificationDeliveries: vi.fn(),
}))
vi.mock("@/lib/api/operations", () => api)

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const tick = (
  name: string,
  minutes: number | null,
  staleAfterSeconds: number,
  stale = false
): SchedulerTick => ({
  name,
  lastCompletedAt: minutes === null ? null : minutesAgo(minutes),
  staleAfterSeconds,
  stale,
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
    for (const key of [
      "jobs",
      "reconcile",
      "retention",
      "presence-resources",
      "sweep",
      "health",
      "keywords",
      "performance",
    ]) {
      expect(within(list).queryByText(key, { exact: true })).toBeNull()
    }
  })

  it("marks staleness against each job's own schedule and says why", async () => {
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

    const jobs = row("Job runner")
    expect(within(jobs).getByText("Stale")).toBeInTheDocument()
    expect(
      within(jobs).getByText("Last run 16 minutes ago")
    ).toBeInTheDocument()
    expect(
      within(jobs).getByText(
        "Expected every minute · stale after 5 minutes without a run"
      )
    ).toBeInTheDocument()

    for (const [label, age] of [
      ["Review check", 19],
      ["Listing sync", 38],
    ] as const) {
      const r = row(label)
      expect(within(r).getByText("On schedule")).toBeInTheDocument()
      expect(within(r).queryByText("Stale")).toBeNull()
      expect(
        within(r).getByText(`Last run ${age} minutes ago`)
      ).toBeInTheDocument()
      expect(
        within(r).getByText(
          "Expected every 15 minutes · stale after 45 minutes without a run"
        )
      ).toBeInTheDocument()
    }

    const healthRow = row("Health checks")
    expect(within(healthRow).getByText("Stale")).toBeInTheDocument()
    expect(within(healthRow).getByText("Never completed")).toBeInTheDocument()
  })

  it("marks a row stale once its window passes even if the payload predates it", async () => {
    api.fetchOperationsHealth.mockResolvedValue(
      health([tick("presence-resources", 50, 2_700, false)])
    )
    api.fetchWebhookFailures.mockResolvedValue({ items: [] })
    renderWithProviders(<OperationsView />)
    const list = await screen.findByRole("list", { name: "Scheduled jobs" })
    expect(within(list).getByText("Stale")).toBeInTheDocument()
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
      within(list).getByText("Stale after 10 minutes without a run")
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
    expect(describeSchedule(SCHEDULED_JOBS.retention, 172_800)).toBe(
      "Expected daily · stale after 2 days without a run"
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
