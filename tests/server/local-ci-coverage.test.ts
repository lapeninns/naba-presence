import { describe, expect, it } from "vitest"

import { GATE_STEPS } from "../../scripts/release/local-receipt.mjs"
import { readRepoText } from "../helpers/repo-text"

describe("local-ci quick-verify coverage by the full release gate", () => {
  it("keeps every quick verification boundary in the native gate", () => {
    const ids = GATE_STEPS.map((step) => step.id)
    for (const id of ["typecheck", "lint", "unit", "format", "design"])
      expect(ids).toContain(id)
    const scripts = JSON.parse(readRepoText("package.json")).scripts
    expect(scripts.verify).toBe(
      "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm check:design --ratchet"
    )
  })

  it("executes the same checks, not a weaker substitute", () => {
    const gate = readRepoText("scripts/release/verify-local.mjs")
    for (const command of [
      'must(sink, "pnpm", ["typecheck"])',
      'must(sink, "pnpm", ["lint"])',
      'must(sink, "pnpm", ["test"],',
      '"scripts/format-changed.mjs",',
      '"--check",',
      'must(sink, "pnpm", ["check:design", "--ratchet"])',
    ])
      expect(gate).toContain(command)
  })
})
