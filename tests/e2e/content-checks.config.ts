import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "content-checks.spec.ts",
  outputDir: "../../test-results/s4-content-checks",
  workers: 1,
  retries: 0,
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
})
