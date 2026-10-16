import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Item 16 of the 2026-10-15 UX results: /sign-in's first-load JS rose by
// about 30 KB gzip once app/(dashboard)/not-found.tsx became a server file
// (a4dcc39f). Next merges every route group's client manifest into one `app`
// group, so the dashboard 404's record for `next/link` and lucide (imported
// by components/app-shell/boundary.tsx) replaced the root 404's, and every
// page outside the dashboard loaded the dashboard 404's chunks with it.
// Measured on served HTML: 36 scripts / 295.3 KB as a server file, 30 /
// 265.5 KB as a client file.
describe("app/(dashboard)/not-found.tsx", () => {
  it("stays a client file, so pages outside the dashboard don't load its chunks", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(dashboard)/not-found.tsx"),
      "utf8"
    )
    expect(source.trimStart().startsWith('"use client"')).toBe(true)
  })
})
