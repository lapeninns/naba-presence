import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { cronPageInput } from "@/lib/server/cron-query"

const vercelJson = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
) as { crons?: Array<{ path?: unknown; schedule?: unknown }> }

function routeSource(path: string): string {
  const routeFile = new URL(`../../app/api/${path}/route.ts`, import.meta.url)
  return readFileSync(routeFile, "utf8")
}

// Every scheduler loop from `scripts/scheduler.mjs`, with the page sizes the
// scheduler POSTed. The bounds live here in the URL because a Vercel cron
// fires GET with no body. `/api/sync/sweep` takes none: it only queues sweep
// checkpoints, and the job runner bounds the work (five pages per claim).
const expectedCrons: Array<{ path: string; schedule: string }> = [
  { path: "/api/jobs/run", schedule: "* * * * *" },
  {
    path: "/api/sync/reconcile?maxOrganisations=100",
    schedule: "*/15 * * * *",
  },
  {
    path: "/api/sync/presence-resources?maxOrganisations=10&maxLocations=5",
    schedule: "7,22,37,52 * * * *",
  },
  {
    path: "/api/sync/performance?maxOrganisations=100&maxLocations=25",
    schedule: "0 */6 * * *",
  },
  {
    path: "/api/sync/sweep",
    schedule: "30 1 * * *",
  },
  {
    path: "/api/sync/keywords?maxOrganisations=100&maxLocations=10",
    schedule: "0 2 * * *",
  },
  {
    path: "/api/cron/retention?batch_size=100",
    schedule: "0 3 * * *",
  },
  // Incidents and alert emails (lib/server/notifications).
  { path: "/api/cron/health", schedule: "*/15 * * * *" },
]

const fieldRanges: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
]

/** Distinct firing slots of one cron field within its period. */
function slots(field: string, period: number): number {
  let total = 0
  for (const part of field.split(",")) {
    const [range, stepPart] = part.split("/")
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (range === "*") {
      total += Math.floor((period - 1) / step) + 1
    } else if (range.includes("-")) {
      const [low, high] = range.split("-").map(Number)
      total += Math.floor((high - low) / step) + 1
    } else {
      total += 1
    }
  }
  return total
}

/** Minimal Vercel cron validation: 5 numeric fields, `*`, lists, ranges, steps. */
function assertValidSchedule(schedule: string) {
  const fields = schedule.trim().split(/\s+/)
  expect(fields, `cron schedule must have 5 fields: ${schedule}`).toHaveLength(
    5
  )
  for (const [index, field] of fields.entries()) {
    expect(
      /^[*,/\d-]+$/.test(field),
      `cron field must be numeric (no MON/SUN/JAN names): ${field}`
    ).toBe(true)
    const [min, max] = fieldRanges[index]
    for (const part of field.split(",")) {
      const [range, step] = part.split("/")
      if (step !== undefined) {
        expect(
          /^\d+$/.test(step) && Number(step) > 0,
          `cron step must be a positive integer: ${part}`
        ).toBe(true)
      }
      if (range === "*") continue
      for (const bound of range.split("-")) {
        const value = Number(bound)
        expect(
          Number.isInteger(value) && value >= min && value <= max,
          `cron field ${index + 1} out of range ${min}-${max}: ${bound}`
        ).toBe(true)
      }
    }
  }
}

describe("Vercel Cron scheduler", () => {
  it("drives all eight scheduler ticks", () => {
    expect(vercelJson.crons).toEqual(expectedCrons)
  })

  it("uses valid UTC cron expressions", () => {
    for (const cron of vercelJson.crons ?? []) {
      assertValidSchedule(String(cron.schedule))
    }
  })

  it("fires each tick at most as often as the scheduler did", () => {
    // The scheduler's cadences, in fires per day: jobs 1440, reconcile 96,
    // presence-resources 96, performance 4, sweep 1, keywords 1, retention 1.
    // A cron firing more often than its loop's interval would overlap itself
    // behind the advisory lock and only log `lease_held` skips.
    const firesPerDay: Record<string, number> = {
      "/api/jobs/run": 1440,
      "/api/sync/reconcile": 96,
      "/api/sync/presence-resources": 96,
      "/api/sync/performance": 4,
      "/api/sync/sweep": 1,
      "/api/sync/keywords": 1,
      "/api/cron/retention": 1,
      "/api/cron/health": 96,
    }
    for (const cron of expectedCrons) {
      const [minute, hour, dayOfMonth, month, dayOfWeek] =
        cron.schedule.split(/\s+/)
      expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "*"])
      const route = cron.path.split("?")[0]
      expect(slots(minute, 60) * slots(hour, 24)).toBeLessThanOrEqual(
        firesPerDay[route]
      )
    }
  })

  it("points every cron at a route with a cron-authenticated GET handler", () => {
    for (const cron of expectedCrons) {
      const route = cron.path.split("?")[0].replace(/^\/api\//, "")
      const source = routeSource(route)
      const declaration = source.indexOf("export const GET = route({")
      expect(declaration, `${cron.path} must export a GET handler`).toBeGreaterThanOrEqual(0)
      const configHead = source.slice(declaration, declaration + 300)
      expect(
        configHead.includes('auth: "cron"'),
        `${cron.path} GET handler must use auth: "cron"`
      ).toBe(true)
    }
  })
})

describe("cronPageInput", () => {
  function input(query: string): Record<string, unknown> {
    return cronPageInput(
      new URLSearchParams(query.startsWith("?") ? query.slice(1) : query)
    )
  }

  it("coerces numeric params and keeps cursors as strings", () => {
    expect(
      input(
        "?maxOrganisations=100&maxLocations=25&organisationCursor=00000000-0000-4000-8000-000000000001"
      )
    ).toEqual({
      maxOrganisations: 100,
      maxLocations: 25,
      organisationCursor: "00000000-0000-4000-8000-000000000001",
    })
  })

  it("drops empty params so schema defaults apply", () => {
    expect(input("?maxOrganisations=&batch_size=")).toEqual({})
  })

  it("leaves non-numeric values for the schema to reject with a 400", () => {
    expect(input("?maxOrganisations=lots")).toEqual({
      maxOrganisations: "lots",
    })
  })
})
