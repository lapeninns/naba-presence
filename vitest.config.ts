import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const alias = {
  "@": fileURLToPath(new URL(".", import.meta.url)),
  "server-only": fileURLToPath(
    new URL("./tests/helpers/server-only-stub.ts", import.meta.url)
  ),
}

export default defineConfig({
  test: {
    // A test that only passes on retry is a failing test with the failure
    // deferred: the JUnit report flags it, and the expectation is a fix or a
    // quarantine issue, not a shrug. Playwright's CI retry is the e2e twin.
    retry: process.env.CI ? 1 : 0,
    // Tests slower than this are printed with their duration. The JUnit
    // report carries per-test timings into the CI artifacts, which is how
    // suite performance is tracked over time.
    slowTestThreshold: 300,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/junit.xml" },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          fileParallelism: false,
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: [
            "tests/components/**/*.test.tsx",
            "tests/components/**/*.test.ts",
          ],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["lib/domain/**/*.ts"],
      reporter: ["text", "json-summary"],
      // Ratchet: set a few points under the measured baseline (81/66/84/81).
      // Raise the thresholds as coverage improves; never lower them to make
      // a change pass.
      thresholds: { statements: 80, branches: 66, functions: 84, lines: 80 },
    },
  },
})
