/**
 * The paths the self-hosted scheduler (scripts/scheduler.mjs) fires, one GET
 * per tick with the cron bearer: exactly the `crons` in vercel.json, so a
 * self-hosted deployment runs the same execution model as Vercel. The sync
 * ticks enqueue (0048) and the job runner does the work; presence resources
 * and billing reconcile follow their own database cursor one page per fire.
 *
 * The scheduler used to POST the sync routes, whose cron branch walks every
 * organisation inline behind a cursor the scheduler kept in memory (W0-02).
 * tests/server/vercel-cron.test.ts keeps this list and vercel.json equal.
 *
 * Keys are the scheduler's tick names, which it logs as `<name>.completed`.
 */
export const SCHEDULER_TICK_PATHS = {
  jobs: "/api/jobs/run",
  reconciliation: "/api/sync/reconcile?maxOrganisations=100",
  presence_resources:
    "/api/sync/presence-resources?maxOrganisations=10&maxLocations=5",
  performance: "/api/sync/performance?maxOrganisations=100&maxLocations=25",
  sweep: "/api/sync/sweep",
  keywords: "/api/sync/keywords?maxOrganisations=100&maxLocations=10",
  retention: "/api/cron/retention",
  health: "/api/cron/health",
  billing_reconcile: "/api/billing/reconcile?maxOrganisations=100",
}
