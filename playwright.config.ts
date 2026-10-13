import { defineConfig } from "@playwright/test"

const port = process.env.PLAYWRIGHT_PORT ?? "3100"
const googleStubPort =
  process.env.PLAYWRIGHT_GOOGLE_STUB_PORT ??
  String(Number.parseInt(port, 10) + 1)
const baseURL = `http://127.0.0.1:${port}`
const tokenEncryptionKey =
  process.env.TOKEN_ENCRYPTION_KEY ?? "route-harness-token-key-32-characters!!"

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/helpers/stub-bridge.ts",
  workers: 1, // §9: pin to one worker (deterministic; no cross-spec CPU contention)
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...(process.env.CI ? {} : { channel: "chrome" as const }),
  },
  projects: [
    // The existing suites, unchanged: unnamed, so titles, output folders and
    // every spec's own viewport are exactly what they were before projects.
    // It is first because the global setup reads projects[0]'s baseURL.
    { testIgnore: /touch-critical\.spec\.ts$/ },
    // The critical journeys on a phone held in the hand (spec
    // docs/specs/2026-10-13-mobile-first-design-system.md, Verification):
    // touch events, mobile viewport meta and a 3x screen. Only its own spec
    // runs here, and only here, so `pnpm test:e2e` runs it once alongside
    // the rest and `pnpm test:e2e:touch` runs it alone.
    {
      name: "touch-390",
      testMatch: /touch-critical\.spec\.ts$/,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
        browserName: "chromium",
      },
    },
  ],
  webServer: {
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
