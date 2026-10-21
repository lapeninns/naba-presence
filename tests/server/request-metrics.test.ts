import { metrics } from "@opentelemetry/api"
import {
  AggregationTemporality,
  MeterProvider,
  MetricReader,
  type DataPoint,
  type Histogram,
} from "@opentelemetry/sdk-metrics"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Instruments bind to the global meter provider when their module loads (as
// instrumentation.ts arranges in the app), so the provider is registered
// before the module under test is imported.
class TestReader extends MetricReader {
  constructor() {
    super({
      aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
    })
  }
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

const reader = new TestReader()
const provider = new MeterProvider({ readers: [reader] })
let subject: typeof import("@/lib/server/request-metrics")

beforeAll(async () => {
  metrics.setGlobalMeterProvider(provider)
  vi.resetModules()
  subject = await import("@/lib/server/request-metrics")
})

afterAll(async () => {
  metrics.disable()
  await provider.shutdown()
})

async function points(name: string) {
  const { resourceMetrics } = await reader.collect()
  const metric = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === name)
  return (metric?.dataPoints ?? []) as DataPoint<unknown>[]
}

const histogram = (point: DataPoint<unknown>) => point.value as Histogram

describe("route labels", () => {
  it("folds identifier-like segments into :id", () => {
    const { routeLabel } = subject
    expect(
      routeLabel("/api/reviews/00000000-0000-4000-8000-000000000001/reply")
    ).toBe("/api/reviews/:id/reply")
    expect(routeLabel("/api/locations/12345/hours")).toBe(
      "/api/locations/:id/hours"
    )
    expect(routeLabel("/api/google/accounts/a1b2c3d4e5f6g7h8")).toBe(
      "/api/google/accounts/:id"
    )
    expect(routeLabel("/api/operations/readiness")).toBe(
      "/api/operations/readiness"
    )
  })

  it("bounds methods and status codes", () => {
    expect(subject.methodLabel("get")).toBe("GET")
    expect(subject.methodLabel("PROPFIND")).toBe("OTHER")
    expect(subject.statusClass(204)).toBe("2xx")
    expect(subject.statusClass(409)).toBe("4xx")
    expect(subject.statusClass(0)).toBe("5xx")
  })
})

describe("withRequestMetrics", () => {
  it("records duration by route, method and status class, and per-request counts", async () => {
    const { withRequestMetrics, countDbTransaction, countGoogleCall } = subject
    const response = await withRequestMetrics(
      { method: "POST", pathname: "/api/reviews/123/reply", cron: false },
      async () => {
        countDbTransaction()
        await Promise.resolve()
        countDbTransaction()
        countGoogleCall("mybusiness.googleapis.com")
        countGoogleCall("mybusiness.googleapis.com")
        countGoogleCall("mybusinessbusinessinformation.googleapis.com")
        return new Response(null, { status: 409 })
      }
    )
    expect(response.status).toBe(409)

    const durations = await points("nabapresence.http.server.duration")
    const duration = durations.find(
      (point) => point.attributes["http.route"] === "/api/reviews/:id/reply"
    )
    expect(duration?.attributes).toEqual({
      "http.route": "/api/reviews/:id/reply",
      "http.request.method": "POST",
      "http.response.status_class": "4xx",
    })
    expect(histogram(duration!).count).toBe(1)

    const transactions = await points(
      "nabapresence.http.server.db_transactions"
    )
    const tx = transactions.find(
      (point) => point.attributes["http.route"] === "/api/reviews/:id/reply"
    )
    expect(histogram(tx!).sum).toBe(2)

    const google = await points("nabapresence.http.server.google_calls")
    const byApi = Object.fromEntries(
      google
        .filter(
          (point) => point.attributes["http.route"] === "/api/reviews/:id/reply"
        )
        .map((point) => [
          point.attributes["server.address"],
          histogram(point).sum,
        ])
    )
    expect(byApi).toEqual({
      "mybusiness.googleapis.com": 2,
      "mybusinessbusinessinformation.googleapis.com": 1,
    })
    // Not a cron route: no tick duration.
    expect(
      (await points("nabapresence.cron.tick.duration")).filter(
        (point) => point.attributes["http.route"] === "/api/reviews/:id/reply"
      )
    ).toEqual([])
  })

  it("records a cron tick, and a thrown handler as 5xx", async () => {
    const { withRequestMetrics } = subject
    await withRequestMetrics(
      { method: "GET", pathname: "/api/jobs/run", cron: true },
      async () => new Response("{}")
    )
    await expect(
      withRequestMetrics(
        { method: "GET", pathname: "/api/sync/sweep", cron: true },
        async () => {
          throw new Error("boom")
        }
      )
    ).rejects.toThrow("boom")
    const ticks = await points("nabapresence.cron.tick.duration")
    expect(
      ticks.map((point) => [
        point.attributes["http.route"],
        point.attributes["http.response.status_class"],
      ])
    ).toEqual(
      expect.arrayContaining([
        ["/api/jobs/run", "2xx"],
        ["/api/sync/sweep", "5xx"],
      ])
    )
  })

  it("counts nothing outside a request", async () => {
    // Attributes and values only: each collection stamps a new endTime, so
    // two reads a millisecond apart differ there even when nothing counted.
    const counts = async () =>
      (await points("nabapresence.http.server.db_transactions")).map(
        ({ attributes, value }) => ({ attributes, value })
      )
    const before = await counts()
    subject.countDbTransaction()
    subject.countGoogleCall("x.googleapis.com")
    expect(await counts()).toEqual(before)
  })

  it("keeps concurrent requests' counts apart", async () => {
    const { withRequestMetrics, countDbTransaction } = subject
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
    await Promise.all(
      [1, 3].map((transactions) =>
        withRequestMetrics(
          {
            method: "GET",
            pathname: `/api/concurrent/n${transactions}`,
            cron: false,
          },
          async () => {
            for (let index = 0; index < transactions; index += 1) {
              await tick()
              countDbTransaction()
            }
            return new Response(null)
          }
        )
      )
    )
    const sums = Object.fromEntries(
      (await points("nabapresence.http.server.db_transactions"))
        .filter((point) =>
          String(point.attributes["http.route"]).startsWith("/api/concurrent/")
        )
        .map((point) => [point.attributes["http.route"], histogram(point).sum])
    )
    expect(sums).toEqual({ "/api/concurrent/n1": 1, "/api/concurrent/n3": 3 })
  })
})

describe("jobs and scheduler metrics", () => {
  it("counts claimed jobs by kind", async () => {
    subject.recordJobsClaimed(["webhook", "checkpoint", "webhook"])
    const claimed = Object.fromEntries(
      (await points("nabapresence.jobs.claimed")).map((point) => [
        point.attributes.kind,
        point.value,
      ])
    )
    expect(claimed).toEqual({ webhook: 2, checkpoint: 1 })
  })

  it("records each completed tick's age and skips one that never ran", async () => {
    const now = new Date("2026-10-14T12:00:00.000Z")
    subject.recordSchedulerTickAges(
      [
        { name: "jobs", lastCompletedAt: "2026-10-14T11:59:30.000Z" },
        { name: "retention", lastCompletedAt: null },
      ],
      now
    )
    const ages = await points("nabapresence.scheduler.tick.age")
    expect(ages.map((point) => [point.attributes.tick, point.value])).toEqual([
      ["jobs", 30],
    ])
  })
})

describe("per-invocation flush on Vercel", () => {
  const ENDPOINT = { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example" }

  it("flushes after the response on Vercel with an endpoint configured", async () => {
    const forceFlush = vi.fn(async () => {})
    const tasks: (() => Promise<void>)[] = []
    subject.flushMetricsAfterResponse({
      env: { VERCEL: "1", ...ENDPOINT },
      provider: { forceFlush },
      schedule: (task) => tasks.push(task),
    })
    expect(forceFlush).not.toHaveBeenCalled()
    expect(tasks).toHaveLength(1)
    await tasks[0]()
    expect(forceFlush).toHaveBeenCalledTimes(1)
  })

  it("does nothing off Vercel or with telemetry disabled", () => {
    const schedule = vi.fn()
    const provider = { forceFlush: vi.fn(async () => {}) }
    for (const env of [
      { ...ENDPOINT },
      { VERCEL: "1" },
      { VERCEL: "1", ...ENDPOINT, OTEL_SDK_DISABLED: "true" },
      { VERCEL: "1", ...ENDPOINT, OTEL_METRICS_EXPORTER: "none" },
    ]) {
      subject.flushMetricsAfterResponse({ env, provider, schedule })
    }
    expect(schedule).not.toHaveBeenCalled()
  })

  it("shares an export in flight and queues at most one more", async () => {
    let release: () => void = () => {}
    const forceFlush = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve))
    )
    const tasks: (() => Promise<void>)[] = []
    for (let index = 0; index < 5; index += 1) {
      subject.flushMetricsAfterResponse({
        env: { VERCEL: "1", ...ENDPOINT },
        provider: { forceFlush },
        schedule: (task) => tasks.push(task),
      })
    }
    const all = Promise.all(tasks.map((task) => task()))
    expect(forceFlush).toHaveBeenCalledTimes(1)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await all
    expect(forceFlush).toHaveBeenCalledTimes(2)
  })

  it("never fails the request when the export fails", async () => {
    const tasks: (() => Promise<void>)[] = []
    subject.flushMetricsAfterResponse({
      env: { VERCEL: "1", ...ENDPOINT },
      provider: { forceFlush: async () => Promise.reject(new Error("down")) },
      schedule: (task) => tasks.push(task),
    })
    await expect(tasks[0]()).resolves.toBeUndefined()
  })
})

// Last: the cap is per process, so filling it would fold every later test's
// routes into `other`.
describe("route label cap", () => {
  it("stops minting new labels past the cap", () => {
    const { routeLabel, MAX_ROUTE_LABELS } = subject
    for (let index = 0; index < MAX_ROUTE_LABELS; index += 1) {
      routeLabel(
        `/api/cap/route-${String.fromCharCode(97 + (index % 26))}${"x".repeat(Math.floor(index / 26))}`
      )
    }
    expect(routeLabel("/api/cap/one-more-new-route")).toBe("other")
    // Labels seen before the cap still resolve to themselves.
    expect(routeLabel("/api/operations/readiness")).toBe(
      "/api/operations/readiness"
    )
  })
})
