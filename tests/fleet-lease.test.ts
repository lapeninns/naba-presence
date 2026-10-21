import { readdirSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { calls, readCode, repoRoot, routeFiles } from "./helpers/route-scanner"

/**
 * withFleetLease (0145, audit W8-05): an expiring row, renewed while the
 * run lasts and ended after it, so a frozen holder's lease lapses on its own.
 */

const state = vi.hoisted(() => ({
  statements: [] as string[],
  /** Whether the take finds the lease free. */
  free: true,
  /** Rows a renewal matches: 0 means another holder took the lease. */
  renewed: 1,
}))

vi.mock("@/lib/server/db", () => {
  const sql = (strings: TemplateStringsArray) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim()
    let rows: unknown[] = []
    if (text.startsWith("insert into fleet_lease")) {
      state.statements.push("take")
      rows = state.free ? [{ name: "naba:jobs" }] : []
    } else if (text.includes("set expires_at = now() + make_interval")) {
      state.statements.push("renew")
      rows = Array.from({ length: state.renewed }, () => ({}))
    } else if (text.startsWith("update fleet_lease set expires_at = now()")) {
      state.statements.push("release")
    }
    return Promise.resolve(rows)
  }
  return { getDatabase: () => sql }
})

const warn = vi.hoisted(() => vi.fn())
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn, error: vi.fn() },
}))

const { FLEET_LEASE_SECONDS, withFleetLease } =
  await import("@/lib/server/leases")

describe("withFleetLease", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.statements = []
    state.free = true
    state.renewed = 1
    warn.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("expires above every leased route's maxDuration", () => {
    // Routes that take a fleet lease: they call withFleetLease, or import a
    // lib module that does. Raising one's maxDuration past the expiry would
    // let a healthy tick lose its lease mid-run.
    const libFiles = (dir: string): string[] =>
      readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap(
        (entry) =>
          entry.isDirectory()
            ? libFiles(`${dir}/${entry.name}`)
            : entry.name.endsWith(".ts")
              ? [`${dir}/${entry.name}`]
              : []
      )
    const leasingModules = libFiles("lib")
      .filter((file) => file !== "lib/server/leases.ts")
      .filter((file) => calls(readCode(file), "withFleetLease"))
      .map((file) => `"@/${file.replace(/\.ts$/, "")}"`)
    const budgets = routeFiles()
      .map((file) => ({ file, code: readCode(file) }))
      .filter(
        ({ code }) =>
          calls(code, "withFleetLease") ||
          leasingModules.some((module) => code.includes(module))
      )
      .map(({ file, code }) => {
        const seconds = /^export const maxDuration = (\d+)$/m.exec(code)?.[1]
        expect(
          seconds,
          `${file} takes a lease without a maxDuration`
        ).toBeDefined()
        return { file, seconds: Number(seconds) }
      })
    expect(budgets.length).toBeGreaterThanOrEqual(9)
    for (const { file, seconds } of budgets) {
      expect(FLEET_LEASE_SECONDS, file).toBeGreaterThan(seconds)
    }
  })

  it("skips without running when another holder's lease is live", async () => {
    state.free = false
    const fn = vi.fn()
    await expect(withFleetLease("naba:jobs", fn)).resolves.toEqual({
      skipped: true,
    })
    expect(fn).not.toHaveBeenCalled()
    expect(state.statements).toEqual(["take"])
  })

  it("renews while the run lasts, and releases only after the last renewal", async () => {
    let finish!: (value: string) => void
    const result = withFleetLease(
      "naba:jobs",
      () => new Promise<string>((resolve) => (finish = resolve))
    )
    await vi.advanceTimersByTimeAsync(65_000)
    expect(state.statements.filter((s) => s === "renew")).toHaveLength(2)
    finish("done")
    await expect(result).resolves.toBe("done")
    expect(state.statements[0]).toBe("take")
    expect(state.statements.at(-1)).toBe("release")
    // No renewal after the release: the timer is gone.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.statements.at(-1)).toBe("release")
  })

  it("says so when a renewal finds the lease taken by another holder", async () => {
    state.renewed = 0
    let finish!: () => void
    const result = withFleetLease(
      "naba:jobs",
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    await vi.advanceTimersByTimeAsync(31_000)
    finish()
    await result
    expect(warn).toHaveBeenCalledWith("leases.lease_lost", { key: "naba:jobs" })
  })

  it("releases the lease when the run throws", async () => {
    await expect(
      withFleetLease("naba:jobs", async () => {
        throw new Error("tick failed")
      })
    ).rejects.toThrow("tick failed")
    expect(state.statements.at(-1)).toBe("release")
  })
})
