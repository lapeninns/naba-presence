import { defineConfig } from "@playwright/test"

const port = process.env.PLAYWRIGHT_PORT ?? "3100"
const googleStubPort =
  process.env.PLAYWRIGHT_GOOGLE_STUB_PORT ??
  String(Number.parseInt(port, 10) + 1)
const baseURL = `http://127.0.0.1:${port}`
const tokenEncryptionKey =
  process.env.TOKEN_ENCRYPTION_KEY ??
  "route-harness-token-key-32-characters!!"

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/helpers/stub-bridge.ts",
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
  webServer: {
    command: `PORT=${port} pnpm start`,
    url: baseURL,
    env: {
      GOOGLE_API_PROXY_BASE: `http://127.0.0.1:${googleStubPort}`,
      NEXTAUTH_URL: baseURL,
      OPENAI_API_KEY: "",
      TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      WEBHOOKS_ENABLED: "false",
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
