import { expect, it } from "vitest"

import { everyOrdering, total } from "./notification-count-orderings.cases"

// The first change is made before the shell's badge is loaded: the badge that
// arrives with the poll is the first answer the count can rest on.
it.each([false, true].map((absorbed) => ({ absorbed })))(
  "pins the badge that arrives after the first change, in every ordering (saved before the poll $absorbed)",
  async ({ absorbed }) => {
    const { runs, problems } = await everyOrdering({
      arrival: false,
      absorbed,
      badgeLoaded: false,
    })
    expect(runs).toBe(total())
    expect(problems.slice(0, 20)).toEqual([])
  },
  600_000
)
