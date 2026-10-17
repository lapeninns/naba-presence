import { expect, it } from "vitest"

import type { NotificationItem } from "@/lib/contracts/operational-notifications"

import { read, resolved, row, views } from "./notification-count-harness"

/**
 * Every ordering of save, lost answer, refusal, poll and new arrival over
 * three changes made at once on two rows. The server takes the changes in
 * order, one at a time; a poll (the shell's badge and a list refetch) lands
 * after `slot` of them have settled, with the next one in flight and, in half
 * the runs, already saved; in half the runs a review arrives just before it.
 *
 * At every step the page and the bell show the same number, and it is what
 * the client believes of the server: the last poll's rows, moved on by each
 * change saved since, with the changes still pending laid over them. After
 * the reconcile that follows the last change, the page, the bell and the
 * cached badge all hold the server's own count.
 */
type Model = { status: "open" | "resolved"; read: boolean }
type Op = readonly ["read" | "unread" | "resolve", "x" | "y"]
type Outcome = "saved" | "refused" | "lost"
type Rows = Record<string, Model>
const OUTCOMES: readonly Outcome[] = ["saved", "refused", "lost"]
const ALPHABET: readonly Op[] = [
  ["read", "x"],
  ["unread", "x"],
  ["read", "y"],
]
const LENGTH = 3

const item = (id: string, model: Model): NotificationItem =>
  model.status === "resolved"
    ? resolved(id, { readAt: model.read ? "2026-09-30T11:00:00.000Z" : null })
    : model.read
      ? read(id)
      : row(id)
const unread = (model: Model) => model.status === "open" && !model.read
const apply = (rows: Rows, [kind, id]: Op) => {
  const target = rows[id]!
  if (kind === "read") target.read = true
  else if (kind === "unread") target.read = false
  else if (target.status === "open") target.status = "resolved"
}
const clone = (rows: Rows): Rows =>
  Object.fromEntries(Object.entries(rows).map(([id, m]) => [id, { ...m }]))
const pick = <T>(all: readonly T[], index: number) =>
  Array.from(
    { length: LENGTH },
    (_, at) => all[Math.floor(index / all.length ** at) % all.length]!
  )

async function run(
  ops: readonly Op[],
  outcomes: readonly Outcome[],
  slot: number,
  absorbed: boolean,
  arrival: boolean,
  badgeLoaded = true
): Promise<string[]> {
  const label = `${ops.map((op, at) => `${op.join(" ")}:${outcomes[at]}`).join(", ")} (poll after ${slot} settled, #${slot + 1} ${absorbed ? "already saved" : "not yet saved"}${arrival ? ", a review arrives" : ""}${badgeLoaded ? "" : ", the badge not loaded until the poll"})`
  const problems: string[] = []
  const v = views()
  const server: Rows = {
    x: { status: "open", read: false },
    y: { status: "open", read: false },
  }
  // N is on the server from the poll on; the client has not seen it before.
  let arrived = false
  let believed: Rows = clone(server)
  let believesArrival = false
  let settled = 0
  let badgeShown = badgeLoaded
  const refresh = async () => {
    const listed = [
      ...(arrived ? [row("n")] : []),
      ...Object.entries(server).map(([id, m]) => item(id, m)),
    ]
    if (!badgeShown) await v.refreshList(listed)
    else
      await v.refresh(
        listed,
        listed.filter((i) => i.status === "open" && !i.readAt)
      )
  }
  const serverCount = () =>
    Object.values(server).filter(unread).length + (arrived ? 1 : 0)
  // What the client believes: the last poll's rows moved on by each change
  // saved since, with every change still pending laid over them.
  const expected = () => {
    const rows = clone(believed)
    for (let at = settled; at < ops.length; at++) apply(rows, ops[at]!)
    return Object.values(rows).filter(unread).length + (believesArrival ? 1 : 0)
  }
  const agree = (when: string) => {
    // Until the badge is loaded there is no bell count to compare.
    if (!badgeShown) return
    const page = v.pageCount()
    const bell = v.bellCount()
    if (page !== bell || bell !== expected())
      problems.push(
        `${label} ${when}: page ${page}, bell ${bell}, expected ${expected()}`
      )
  }
  await refresh()
  const made = ops.map((op) =>
    v.make({
      kind: op[0] === "resolve" ? "resolve" : "read",
      ids: [op[1]],
      read: op[0] === "read" ? true : op[0] === "unread" ? false : undefined,
    })
  )
  for (let at = 0; at < LENGTH; at++) {
    if (at === slot) {
      if (absorbed && outcomes[at] !== "refused") apply(server, ops[at]!)
      arrived = arrival
      believed = clone(server)
      believesArrival = arrived
      badgeShown = true
      await refresh()
      agree("at the poll")
    }
    // The server takes the change; the answer comes back, or does not.
    if (outcomes[at] !== "refused") apply(server, ops[at]!)
    if (outcomes[at] === "saved") {
      apply(believed, ops[at]!)
      await v.commit(made[at]!)
    } else await v.remove(made[at]!)
    settled = at + 1
    agree(`after #${at + 1}`)
  }
  // The reconcile after the last change.
  await refresh()
  const truth = serverCount()
  if (
    v.rawBadge() !== truth ||
    v.pageCount() !== truth ||
    v.bellCount() !== truth
  )
    problems.push(
      `${label} end: badge ${v.rawBadge()}, page ${v.pageCount()}, bell ${v.bellCount()}, server ${truth}`
    )
  v.unmount()
  return problems
}

const NO_BADGE = [false, true].map((absorbed) => ({ absorbed }))
const SLICES = [false, true].flatMap((arrival) =>
  [false, true].map((absorbed) => ({ arrival, absorbed }))
)
const total = () =>
  ALPHABET.length ** LENGTH * OUTCOMES.length ** LENGTH * LENGTH

it.each(SLICES)(
  "keeps page and bell on one total, and on the server's after the reconcile, in every ordering (arrival $arrival, saved before the poll $absorbed)",
  async ({ arrival, absorbed }) => {
    const problems: string[] = []
    let runs = 0
    for (let slot = 0; slot < LENGTH; slot++)
      for (let a = 0; a < ALPHABET.length ** LENGTH; a++)
        for (let b = 0; b < OUTCOMES.length ** LENGTH; b++) {
          runs++
          problems.push(
            ...(await run(
              pick(ALPHABET, a),
              pick(OUTCOMES, b),
              slot,
              absorbed,
              arrival
            ))
          )
        }
    expect(runs).toBe(total())
    expect(problems.slice(0, 20)).toEqual([])
  },
  600_000
)

// The first change is made before the shell's badge is loaded: the badge that
// arrives with the poll is the first answer the count can rest on.
it.each(NO_BADGE)(
  "pins the badge that arrives after the first change, in every ordering (saved before the poll $absorbed)",
  async ({ absorbed }) => {
    const problems: string[] = []
    for (let slot = 0; slot < LENGTH; slot++)
      for (let a = 0; a < ALPHABET.length ** LENGTH; a++)
        for (let b = 0; b < OUTCOMES.length ** LENGTH; b++)
          problems.push(
            ...(await run(
              pick(ALPHABET, a),
              pick(OUTCOMES, b),
              slot,
              absorbed,
              false,
              false
            ))
          )
    expect(problems.slice(0, 20)).toEqual([])
  },
  600_000
)
