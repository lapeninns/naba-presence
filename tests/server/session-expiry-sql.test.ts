import { describe, expect, it } from "vitest"

import { readRepoText } from "../helpers/repo-text"

// Session lifetimes are counted in 24-hour days. `interval '1 day'` added to a
// timestamptz follows the database TimeZone across a DST change, so a 14-day
// idle window would be 14 days plus or minus an hour. The integration suite
// only notices within 14 days of a clock change on a DST zone, so pin the SQL.
describe("session expiry SQL", () => {
  for (const path of ["lib/server/session.ts", "lib/server/session-store.ts"]) {
    it(`${path} counts session windows in 24-hour days`, () => {
      const source = readRepoText(path)
      expect(source).not.toMatch(/interval\s+'1\s+days?'/i)
      expect(source).toContain("interval '24 hours'")
    })
  }

  it("sets both the idle and absolute expiry at sign-in in 24-hour days", () => {
    const source = readRepoText("lib/server/session-store.ts")
    expect(source).toContain(
      "now() + (${Math.min(idleDays, absoluteDays)} * interval '24 hours')"
    )
    expect(source).toContain("now() + (${absoluteDays} * interval '24 hours')")
  })

  it("slides the idle window in 24-hour days", () => {
    expect(readRepoText("lib/server/session.ts")).toContain(
      "now() + (${getServerEnv().SESSION_IDLE_DAYS} * interval '24 hours')"
    )
  })
})
