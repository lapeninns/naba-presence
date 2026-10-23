import type postgres from "postgres"

import { DISPOSABLE_SETTING } from "../../../scripts/test-database.mjs"

type Sql = ReturnType<typeof postgres>

/**
 * Platform-wide rows the suites change and an interrupted run can leave
 * behind: operator pauses (set_ops_pause), fleet leases (`naba:%`, held for
 * up to FLEET_LEASE_SECONDS by a server killed mid-tick) and the test plans
 * five suites insert into billing_plan. Resetting them is only safe on a
 * cluster that scripts/ci/postgres.mjs made for this run: on any other
 * database the reset could unpause a real operator pause or break a running
 * scheduler's lease, so it is skipped there.
 */

let disposable: boolean | undefined

/** Whether `admin` reaches a throwaway cluster from scripts/ci/postgres.mjs. */
export async function isDisposableCluster(admin: Sql): Promise<boolean> {
  if (disposable === undefined) {
    const [row] = await admin<{ value: string | null }[]>`
      select current_setting(${DISPOSABLE_SETTING}, true) as value
    `
    disposable = row?.value === "on"
    if (!disposable) {
      console.warn(
        "[platform-state] not a throwaway cluster from scripts/ci/postgres.mjs: " +
          "leaving pauses, fleet leases and billing plans as they are"
      )
    }
  }
  return disposable
}

/**
 * Ends every live `naba:%` fleet lease and lifts every operator pause, so a
 * tick's outcome depends only on the test in hand. Returns false (and
 * changes nothing) off a throwaway cluster.
 */
export async function resetFleetState(admin: Sql): Promise<boolean> {
  if (!(await isDisposableCluster(admin))) return false
  await admin`
    update fleet_lease set expires_at = now()
    where name like 'naba:%' and expires_at > now()
  `
  await admin`
    select set_ops_pause(
      scope, false, 'Integration harness reset', 'integration-harness'
    )
    from ops_pause_control
    where paused
  `
  return true
}

/**
 * resetFleetState plus the test plans: every test-environment test offer no
 * billing row still points at (no migration seeds a plan, so on a throwaway
 * cluster each one is a suite's). For the end of a run.
 */
export async function resetPlatformState(admin: Sql): Promise<boolean> {
  if (!(await resetFleetState(admin))) return false
  await admin`
    delete from billing_plan p
    where p.environment = 'test'
      and p.is_test_offer
      and not exists (
        select 1 from organisation_billing b
        where p.id in (b.plan_id, b.pending_plan_id, b.checkout_plan_id)
      )
  `
  return true
}
