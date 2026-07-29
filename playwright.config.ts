import { defineConfig } from "@playwright/test"

const port = process.env.PLAYWRIGHT_PORT ?? "3000"
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./tests/e2e",
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
    command:
      port === "3000" ? "pnpm start" : `PORT=${port} pnpm start`,
    url: baseURL,
    reuseExistingServer:
      !process.env.CI && process.env.PLAYWRIGHT_PORT === undefined,
    timeout: 30_000,
  },
})
