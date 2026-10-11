import postgres from "postgres"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

import { createTestTenant, destroyTenants } from "../helpers/tenant"

import { ApiError } from "@/lib/server/http"
import {
  RETENTION_ORG_MAX_ATTEMPTS,
  claimOrganisation,
  nextOrganisations,
  openOrResumeCycle,
  retentionCycleFailureFinding,
  runRetentionCycle,
} from "@/lib/server/retention/cycle"
import type { OrganisationPurgeInput } from "@/lib/server/retention/purge"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type CycleRow = {
  id: string
  cycleDate: string
  status: string
  enumerated: number
  succeeded: number
  failed: number
  enumerationCursor: string | null
  enumerationCompletedAt: Date | null
}

type OrgRow = {
  organisationId: string
  status: string
  attempts: number
  lastErrorCode: string | null
}

// The dispatcher's cycle bookkeeping, driven directly with an injected clock
// and an injected per-organisation purge, so the walk can be stepped fire by
// fire and made to fail. The purge itself is covered by retention-purge.test.ts
// and the route by leases.test.ts / vercel-cron-ticks.test.ts.
describeDatabase("retention cycle dispatcher", () => {
  let admin: ReturnType<typeof postgres>
  const organisations: string[] = []
  const budget = process.env.RETENTION_BUDGET_MS

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    for (let index = 0; index < 5; index += 1) {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
    }
  })

  beforeEach(async () => {
    await admin`delete from retention_cycle`
  })

  afterEach(() => {
    if (budget === undefined) delete process.env.RETENTION_BUDGET_MS
    else process.env.RETENTION_BUDGET_MS = budget
  })

  afterAll(async () => {
    await admin`delete from retention_cycle`
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fleetSize(): Promise<number> {
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from organisation_job_route
    `
    return row.count
  }

  async function cycles(): Promise<CycleRow[]> {
    return admin<CycleRow[]>`
      select
        id::text as id,
        to_char(cycle_date, 'YYYY-MM-DD') as "cycleDate",
        status,
        enumerated,
        succeeded,
        failed,
        enumeration_cursor::text as "enumerationCursor",
        enumeration_completed_at as "enumerationCompletedAt"
      from retention_cycle
      order by cycle_date
    `
  }

  async function orgRows(cycleId: string): Promise<Map<string, OrgRow>> {
    const rows = await admin<OrgRow[]>`
      select
        organisation_id::text as "organisationId",
        status,
        attempts,
        last_error_code as "lastErrorCode"
      from retention_cycle_org
      where cycle_id = ${cycleId}
    `
    return new Map(rows.map((row) => [row.organisationId, row]))
  }

  function recordingPurge(
    failing: (organisationId: string) => boolean = () => false
  ) {
    const calls: string[] = []
    const purge = async ({ organisationId }: OrganisationPurgeInput) => {
      calls.push(organisationId)
      if (failing(organisationId)) {
        throw new ApiError(500, "test_failure", "Injected retention failure.")
      }
      return { reviews: 0 }
    }
    return { calls, purge }
  }

  function fire(
    now: string,
    purge: ReturnType<typeof recordingPurge>["purge"],
    pageSize = 2
  ) {
    return runRetentionCycle({
      requestId: "retention-cycle-test",
      clientRequestId: null,
      now: new Date(now),
      pageSize,
      purge,
    })
  }

  it("opens nothing before 03:00 UTC and opens the day's cycle at 03:00", async () => {
    const { calls, purge } = recordingPurge()
    const early = await fire("2026-01-06T02:59:59Z", purge)
    expect(early).toMatchObject({
      cycle: null,
      opened: false,
      completed: false,
    })
    expect(calls).toEqual([])
    expect(await cycles()).toEqual([])

    const due = await fire("2026-01-06T03:00:00Z", purge, 100)
    expect(due.opened).toBe(true)
    expect(due.cycle?.cycleDate).toBe("2026-01-06")
    expect(due.completed).toBe(true)
  })

  it("walks a fleet larger than one page across fires and completes once", async () => {
    const fleet = await fleetSize()
    expect(fleet).toBeGreaterThan(2)
    const { calls, purge } = recordingPurge()

    // A zero budget stops each fire after its first organisation, so the
    // walk has to resume from the persisted cycle.
    process.env.RETENTION_BUDGET_MS = "0"
    const first = await fire("2026-01-05T04:00:00Z", purge)
    expect(first.opened).toBe(true)
    expect(first.completed).toBe(false)
    expect(first.organisations).toHaveLength(1)
    const second = await fire("2026-01-05T04:05:00Z", purge)
    expect(second.opened).toBe(false)
    expect(second.completed).toBe(false)
    expect(second.cycle?.id).toBe(first.cycle?.id)
    const [partial] = await cycles()
    expect(partial).toMatchObject({
      status: "running",
      succeeded: 2,
      failed: 0,
    })
    expect(partial.enumerationCursor).not.toBeNull()

    delete process.env.RETENTION_BUDGET_MS
    let last = second
    for (let index = 0; index < 10 && !last.completed; index += 1) {
      last = await fire("2026-01-05T04:10:00Z", purge)
    }
    expect(last.completed).toBe(true)

    const [cycle] = await cycles()
    expect(cycle).toMatchObject({
      cycleDate: "2026-01-05",
      status: "completed",
      enumerated: fleet,
      succeeded: fleet,
      failed: 0,
    })
    expect(cycle.enumerationCompletedAt).not.toBeNull()
    // Every organisation ran exactly once.
    expect(calls).toHaveLength(fleet)
    expect(new Set(calls).size).toBe(fleet)
    const rows = await orgRows(cycle.id)
    for (const organisationId of organisations) {
      expect(rows.get(organisationId)).toMatchObject({
        status: "succeeded",
        attempts: 1,
      })
    }

    // The tick ledger hears about the finished cycle.
    const [heartbeat] = await admin<{ lastCycleCompletedAt: Date | null }[]>`
      select last_cycle_completed_at as "lastCycleCompletedAt"
      from ops_heartbeat where name = 'retention'
    `
    expect(heartbeat.lastCycleCompletedAt).not.toBeNull()

    // A second fire the same day finds the cycle completed and does nothing.
    const again = recordingPurge()
    const repeat = await fire("2026-01-05T23:55:00Z", again.purge)
    expect(repeat).toMatchObject({ cycle: null, completed: false })
    expect(again.calls).toEqual([])
    expect(await cycles()).toHaveLength(1)
  })

  it("records a failing organisation, retries it on later fires and never blocks the rest", async () => {
    const fleet = await fleetSize()
    const [alwaysFails, failsOnce] = organisations
    let failedOnce = false
    const { calls, purge } = recordingPurge((organisationId) => {
      if (organisationId === alwaysFails) return true
      if (organisationId === failsOnce && !failedOnce) {
        failedOnce = true
        return true
      }
      return false
    })

    const first = await fire("2026-01-07T05:00:00Z", purge, 100)
    expect(first.completed).toBe(false)
    expect(
      first.failures.map((failure) => failure.organisationId).sort()
    ).toEqual([alwaysFails, failsOnce].sort())
    // Everyone else was retained on the same fire.
    expect(first.organisations).toHaveLength(fleet - 2)
    let [cycle] = await cycles()
    expect(cycle).toMatchObject({ succeeded: fleet - 2, failed: 2 })

    // Retries come on later fires only, one run each.
    const second = await fire("2026-01-07T05:05:00Z", purge, 100)
    expect(second.completed).toBe(false)
    expect(second.organisations.map((entry) => entry.organisationId)).toEqual([
      failsOnce,
    ])
    expect(second.failures.map((failure) => failure.organisationId)).toEqual([
      alwaysFails,
    ])
    ;[cycle] = await cycles()
    expect(cycle).toMatchObject({ succeeded: fleet - 1, failed: 1 })

    let last = second
    for (
      let index = 0;
      index < RETENTION_ORG_MAX_ATTEMPTS && !last.completed;
      index += 1
    ) {
      last = await fire("2026-01-07T05:10:00Z", purge, 100)
    }
    expect(last.completed).toBe(true)
    ;[cycle] = await cycles()
    expect(cycle).toMatchObject({
      status: "completed",
      enumerated: fleet,
      succeeded: fleet - 1,
      failed: 1,
    })
    const rows = await orgRows(cycle.id)
    expect(rows.get(alwaysFails)).toMatchObject({
      status: "failed",
      attempts: RETENTION_ORG_MAX_ATTEMPTS,
      lastErrorCode: "test_failure",
    })
    expect(rows.get(failsOnce)).toMatchObject({
      status: "succeeded",
      attempts: 2,
    })
    expect(calls.filter((id) => id === alwaysFails)).toHaveLength(
      RETENTION_ORG_MAX_ATTEMPTS
    )
  })

  it("resumes an organisation whose fire was killed, and gives up on one killed every time", async () => {
    const fleet = await fleetSize()
    const now = new Date("2026-01-08T03:30:00Z")
    const opened = await openOrResumeCycle(now)
    expect(opened?.opened).toBe(true)
    const cycleId = opened!.cycle.id
    const [killed, poisoned, retryKilled] = await nextOrganisations(cycleId, {
      limit: 3,
    })
    // A fire claims an organisation and dies before settling it: the row
    // says so rather than looking untouched.
    expect(await claimOrganisation(cycleId, killed)).toBe(true)
    expect((await orgRows(cycleId)).get(killed)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastErrorCode: "attempt_interrupted",
    })
    // Another has been killed on every one of its runs.
    await admin`
      update retention_cycle_org
      set attempts = ${RETENTION_ORG_MAX_ATTEMPTS}
      where cycle_id = ${cycleId} and organisation_id = ${poisoned}
    `
    // A third failed earlier, and its last retry was killed: the earlier
    // error must not stand in for the kill.
    await admin`
      update retention_cycle_org
      set status = 'failed', attempts = ${RETENTION_ORG_MAX_ATTEMPTS - 1},
        last_error_code = 'test_failure'
      where cycle_id = ${cycleId} and organisation_id = ${retryKilled}
    `
    await admin`
      update retention_cycle set failed = failed + 1 where id = ${cycleId}
    `
    expect(await claimOrganisation(cycleId, retryKilled)).toBe(true)

    const { calls, purge } = recordingPurge()
    const result = await fire("2026-01-08T03:35:00Z", purge, 100)
    expect(result.opened).toBe(false)
    expect(result.completed).toBe(true)
    expect(calls).toContain(killed)
    expect(calls).not.toContain(poisoned)
    expect(calls).not.toContain(retryKilled)

    const [cycle] = await cycles()
    expect(cycle).toMatchObject({
      status: "completed",
      enumerated: fleet,
      succeeded: fleet - 2,
      failed: 2,
    })
    const rows = await orgRows(cycleId)
    expect(rows.get(killed)).toMatchObject({
      status: "succeeded",
      attempts: 2,
      lastErrorCode: null,
    })
    expect(rows.get(poisoned)).toMatchObject({
      status: "failed",
      lastErrorCode: "attempts_exhausted",
    })
    expect(rows.get(retryKilled)).toMatchObject({
      status: "failed",
      attempts: RETENTION_ORG_MAX_ATTEMPTS,
      lastErrorCode: "attempt_interrupted",
    })
  })

  it("raises a failures finding for a cycle that completed with failed organisations, until one completes clean", async () => {
    const [alwaysFails] = organisations
    let failing = true
    const { purge } = recordingPurge(
      (organisationId) => failing && organisationId === alwaysFails
    )
    async function completeDay(day: string) {
      let last = await fire(`${day}T03:00:00Z`, purge, 100)
      for (
        let index = 0;
        index < RETENTION_ORG_MAX_ATTEMPTS && !last.completed;
        index += 1
      ) {
        last = await fire(`${day}T03:05:00Z`, purge, 100)
      }
      expect(last.completed).toBe(true)
    }

    expect(await retentionCycleFailureFinding()).toBeNull()
    await completeDay("2026-01-12")
    expect(await retentionCycleFailureFinding()).toMatchObject({
      kind: "tick_cycle_failures",
      subject: "retention",
      details: {
        cycleDate: "2026-01-12",
        failed: 1,
        repeated: 0,
        organisations: [
          {
            organisationId: alwaysFails,
            attempts: RETENTION_ORG_MAX_ATTEMPTS,
            lastErrorCode: "test_failure",
            failedPreviousCycle: false,
          },
        ],
      },
    })

    // The same tenant fails again the next day: the finding says it repeats.
    await completeDay("2026-01-13")
    expect(await retentionCycleFailureFinding()).toMatchObject({
      details: {
        cycleDate: "2026-01-13",
        failed: 1,
        repeated: 1,
        organisations: [
          { organisationId: alwaysFails, failedPreviousCycle: true },
        ],
      },
    })

    // While the next day's cycle is still running, the last completed one
    // still stands.
    failing = false
    process.env.RETENTION_BUDGET_MS = "0"
    const started = await fire("2026-01-14T03:00:00Z", purge, 100)
    expect(started.completed).toBe(false)
    expect(await retentionCycleFailureFinding()).toMatchObject({
      details: { cycleDate: "2026-01-13" },
    })
    delete process.env.RETENTION_BUDGET_MS
    await completeDay("2026-01-14")
    expect(await retentionCycleFailureFinding()).toBeNull()
  })

  it("finishes yesterday's unfinished cycle before 03:00 and opens today's after it", async () => {
    await admin`
      insert into retention_cycle (cycle_date) values ('2026-01-09')
    `
    const { purge } = recordingPurge()
    const resumed = await fire("2026-01-10T01:00:00Z", purge, 100)
    expect(resumed.opened).toBe(false)
    expect(resumed.cycle?.cycleDate).toBe("2026-01-09")
    expect(resumed.completed).toBe(true)

    // Still before 03:00: nothing running, nothing to open.
    expect((await fire("2026-01-10T02:00:00Z", purge, 100)).cycle).toBeNull()

    const today = await fire("2026-01-10T03:05:00Z", purge, 100)
    expect(today.opened).toBe(true)
    expect(today.cycle?.cycleDate).toBe("2026-01-10")
    expect((await cycles()).map((cycle) => cycle.status)).toEqual([
      "completed",
      "completed",
    ])
  })

  it("prunes completed cycles past the reporting window when a new one opens", async () => {
    await admin`
      insert into retention_cycle (cycle_date, status, completed_at)
      values ('2025-11-01', 'completed', now()), ('2026-01-01', 'completed', now())
    `
    const { purge } = recordingPurge()
    await fire("2026-01-11T03:00:00Z", purge, 100)
    expect((await cycles()).map((cycle) => cycle.cycleDate)).toEqual([
      "2026-01-01",
      "2026-01-11",
    ])
  })
})
