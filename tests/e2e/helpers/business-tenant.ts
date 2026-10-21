import { test as base } from "@playwright/test"
import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
} from "../../integration/helpers/tenant"

type Admin = ReturnType<typeof postgres>

/**
 * A dedicated business-mode organisation for one test, signed in on the
 * test's own page.
 *
 * The cookie-less harness page bootstraps the shared local organisation
 * (`provision_local_bootstrap`, agency by default) and the global journey
 * tenant is agency too, so neither can host a business-mode scan, and
 * switching either one's mode would change every other spec's tenant. This
 * fixture seeds a fresh owner with `createTestTenant({ workspaceMode:
 * "business" })` (an organisation, its home client, an owner and a session,
 * as provisioning creates for a new business), sets that session's cookie on
 * the page's context for the harness server, and destroys the organisation
 * after the test.
 *
 * The fixture runs for every test of a spec that imports this `test` (it is
 * `auto`), and throws when the harness database is not reachable from the test
 * process: a broken business tenant fails the test with that reason. It used to
 * skip, which let a run pass with the whole file unrun (the hosted run of
 * 2026-10-03 passed "18 skipped").
 */
export const test = base.extend<
  { businessTenant: { organisationId: string } },
  { harnessAdmin: Admin | null }
>({
  harnessAdmin: [
    // Playwright requires the first fixture argument to be destructured.
    async ({}, provide) => {
      const url = process.env.DIRECT_DATABASE_URL
      const admin = url ? postgres(url, { max: 1 }) : null
      await provide(admin)
      await admin?.end()
    },
    { scope: "worker" },
  ],
  businessTenant: [
    async ({ harnessAdmin, page, baseURL }, provide) => {
      if (!harnessAdmin) throw new Error(NO_BUSINESS_TENANT)
      if (!baseURL) throw new Error(NO_BASE_URL)
      const tenant = await createTestTenant(harnessAdmin, {
        workspaceMode: "business",
      })
      try {
        await page.context().addCookies([
          {
            name: "naba_session",
            value: tenant.cookie.slice("naba_session=".length),
            url: baseURL,
            httpOnly: true,
            sameSite: "Lax",
          },
        ])
        await provide({ organisationId: tenant.organisationId })
      } finally {
        await destroyTenants(harnessAdmin, [tenant.organisationId])
      }
    },
    { auto: true },
  ],
})

export const NO_BUSINESS_TENANT =
  "No business-mode tenant: DIRECT_DATABASE_URL (the harness database) is not set in the test process."
const NO_BASE_URL =
  "No business-mode tenant: the test has no baseURL to sign the page in to."
