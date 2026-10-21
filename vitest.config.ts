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
    // Unit and component files run in parallel. The Mac is shared with
    // other repositories' runs, so cap the pool; VITEST_MAX_WORKERS
    // overrides it (a number, or a percentage of the cores).
    maxWorkers: process.env.VITEST_MAX_WORKERS ?? "50%",
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**", "tests/integration/**"],
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
      {
        // Real PostgreSQL and real app servers, run through
        // `pnpm test:integration` (scripts/run-test-command.mjs). Files share
        // one database and the global fleet leases, so they run one at a time.
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          fileParallelism: false,
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
    coverage: { include: ["lib/domain/**/*.ts"] },
  },
})
