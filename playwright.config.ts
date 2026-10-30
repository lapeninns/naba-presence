import { defineConfig } from "@playwright/test"

const port = process.env.PLAYWRIGHT_PORT ?? "3100"
const googleStubPort =
  process.env.PLAYWRIGHT_GOOGLE_STUB_PORT ??
  String(Number.parseInt(port, 10) + 1)
const baseURL = `http://127.0.0.1:${port}`
const tokenEncryptionKey =
  process.env.TOKEN_ENCRYPTION_KEY ?? "route-harness-token-key-32-characters!!"

// PLAYWRIGHT_SUITE=shared|isolated splits the suite into two invocations that
// run at the same time (the release gate does); unset runs everything.
const suite = process.env.PLAYWRIGHT_SUITE
// The specs that start their own app server, Google stub and tenant and read
// no journey state: they need neither the global setup nor the :3100 server.
const ISOLATED =
  /(lodging-complete-backend|lodging-recovery-backend|services-backend|administration-access-backend|administration-access-recovery|lifecycle-backend|verification-pin-backend|verification-pin-drift|verification-pin-recovery|verification-start-backend|place-actions-backend|operations-features|approval-notifications|google-change-watch-backend)\.spec\.ts$/
const TOUCH = /touch-critical\.spec\.ts$/

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup:
    suite === "isolated" ? undefined : "./tests/e2e/helpers/stub-bridge.ts",
  // Each invocation needs its own output folder: Playwright empties it at the
  // start of a run, and the journey state file lives beside it.
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  workers: 1, // §9: pin to one worker (deterministic; no cross-spec CPU contention)
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Playwright's pinned Chromium everywhere, so the gate does not depend on
    // whichever Chrome a machine has installed (`playwright install
    // chromium`). PLAYWRIGHT_CHANNEL=chrome opts into the system browser.
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  },
  projects: [
    // The existing suites, unchanged: unnamed, so titles, output folders and
    // every spec's own viewport are exactly what they were before projects.
    // It is first because the global setup reads projects[0]'s baseURL.
    {
      testIgnore: suite === "shared" ? [TOUCH, ISOLATED] : [TOUCH],
      ...(suite === "isolated" ? { testMatch: ISOLATED } : {}),
    },
    // The critical journeys on a phone held in the hand (spec
    // docs/specs/2026-10-13-mobile-first-design-system.md, Verification):
    // touch events, mobile viewport meta and a 3x screen. Only its own spec
    // runs here, and only here, so `pnpm test:e2e` runs it once alongside
    // the rest and `pnpm test:e2e:touch` runs it alone.
    {
      name: "touch-390",
      testMatch: suite === "isolated" ? /^$/ : TOUCH,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
        browserName: "chromium",
      },
    },
  ],
  webServer:
    suite === "isolated"
      ? undefined
      : {
          command: `PORT=${port} pnpm start`,
          url: baseURL,
          env: {
            GOOGLE_API_PROXY_BASE: `http://127.0.0.1:${googleStubPort}`,
            NEXTAUTH_URL: baseURL,
            OPENAI_API_KEY: "",
            TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
            WEBHOOKS_ENABLED: "false",
            PASSWORD_AUTH_ENABLED: "false",
            GBP_PROFILE_WRITES_ENABLED: "true",
            GBP_MEDIA_ENABLED: "true",
            GBP_POSTS_ENABLED: "true",
            GBP_FOOD_MENUS_ENABLED: "true",
            GBP_PLACE_ACTIONS_ENABLED: "true",
            GBP_PERFORMANCE_ENABLED: "true",
            GBP_KEYWORDS_ENABLED: "true",
            // The specs sign in and draft far faster than any person, and the
            // counters outlive a run in the shared database, so back-to-back runs
            // would trip them. tests/integration/routes/abuse-limits.test.ts owns
            // the limiter's behaviour.
            ABUSE_LIMITS_ENABLED: "false",
            // `pnpm start` is a production build, so the route defaults off. The
            // accessibility and axe specs measure it, so turn it on here - this
            // object is merged last into the served app's environment.
            DESIGN_SYSTEM_EVIDENCE_ENABLED: "true",
            // Off by default (P06-5); auth.spec.ts covers the choice itself.
            REGISTRATION_WORKSPACE_CHOICE_ENABLED: "true",
            // The Billing and Usage screens (P07-S6) exist only with billing on.
            // No Stripe key is set, so every billing action stays fail-closed
            // (503 billing_unavailable); tests/e2e/billing.spec.ts stubs reads.
            BILLING_ENABLED: "true",
          },
          reuseExistingServer: false,
          timeout: 30_000,
        },
})
