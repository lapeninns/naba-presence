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
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
    ],
    coverage: { include: ["lib/domain/**/*.ts"] },
  },
})
