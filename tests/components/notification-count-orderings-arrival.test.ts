import { expect, it } from "vitest"

import { everyOrdering, total } from "./notification-count-orderings.cases"

// Slices with a review arriving before the poll; the rest are in the
// sibling notification-count-orderings*.test.ts files.
it.each([false, true].map((absorbed) => ({ absorbed })))(
  "keeps page and bell on one total, and on the server's after the reconcile, in every ordering (arrival true, saved before the poll $absorbed)",
  async ({ absorbed }) => {
    const { runs, problems } = await everyOrdering({
      arrival: true,
      absorbed,
    })
    expect(runs).toBe(total())
    expect(problems.slice(0, 20)).toEqual([])
  },
  600_000
)
