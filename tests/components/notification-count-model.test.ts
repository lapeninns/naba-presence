import { describe, expect, it } from "vitest"

import { act } from "@testing-library/react"

import { queryKeys } from "@/lib/queries/keys"

import { page, read, resolved, row, views } from "./notification-count-harness"

/**
 * The unread count has one model: the page, the bell and the pin under them
 * all read the same total, and it comes back to the server's whatever the
 * order of save, lost answer, removal, poll and new arrival. Each family
 * below was reported against #191 (AMA-19) and is run on the real helpers.
 */
describe("poll after removal", () => {
  it("follows a poll that lands after the lost change is removed, while the other is still pending", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const lost = v.make({ kind: "read", ids: ["x"], read: true })
    const survivor = v.make({ kind: "read", ids: ["y"], read: true })
    // X saved on the server but its answer was lost: the change is taken
    // back before any poll has shown the save.
    await v.remove(lost)
    // The poll now brings X read, Y unread, count 1.
    await v.refresh([read("x"), row("y")], [row("y")])
    expect(v.pageCount()).toBe(0)
    expect(v.bellCount()).toBe(0)
    // Y saves; nothing else has been refetched yet.
    await v.commit(survivor)
    expect(v.pageCount()).toBe(0)
    expect(v.bellCount()).toBe(0)
    expect(v.rawBadge()).toBe(0)
    v.unmount()
  })

  it("does the same when only the shell's poll lands", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const lost = v.make({ kind: "read", ids: ["x"], read: true })
    const survivor = v.make({ kind: "read", ids: ["y"], read: true })
    await v.remove(lost)
    await v.poll([row("y")])
    expect(v.bellCount()).toBe(0)
    await v.commit(survivor)
    expect(v.rawBadge()).toBe(0)
    expect(v.bellCount()).toBe(0)
    v.unmount()
  })

  it("keeps a lost change that the server never saved counted", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const lost = v.make({ kind: "read", ids: ["x"], read: true })
    const survivor = v.make({ kind: "read", ids: ["y"], read: true })
    await v.remove(lost)
    // The poll shows X still unread: the lost change never reached the server.
    await v.refresh([row("x"), row("y")], [row("x"), row("y")])
    expect(v.bellCount()).toBe(1)
    expect(v.pageCount()).toBe(1)
    await v.commit(survivor)
    expect(v.rawBadge()).toBe(1)
    expect(v.bellCount()).toBe(1)
    v.unmount()
  })

  it("follows a poll that lands after the lost resolve is removed", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const lost = v.make({ kind: "resolve", ids: ["x"] })
    const survivor = v.make({ kind: "read", ids: ["y"], read: true })
    await v.remove(lost)
    await v.refresh([resolved("x"), row("y")], [row("y")])
    expect(v.bellCount()).toBe(0)
    await v.commit(survivor)
    expect(v.rawBadge()).toBe(0)
    expect(v.pageCount()).toBe(0)
    v.unmount()
  })
})

describe("no initial pin", () => {
  it("pins the badge that arrives after a change was made, and counts the change once", async () => {
    const v = views()
    // The list is loaded, the shell's badge is not.
    v.client.setQueryData(queryKeys.notifications("all"), {
      pages: [page([row("x"), row("y")])],
      pageParams: [""],
    })
    const change = v.make({ kind: "read", ids: ["x"], read: true })
    // The server saved X before the badge was asked: it says 1, Y unread.
    await v.poll([row("y")])
    expect(v.bellCount()).toBe(1)
    await v.commit(change)
    expect(v.rawBadge()).toBe(1)
    expect(v.bellCount()).toBe(1)
    v.unmount()
  })

  it("counts the change when the badge that arrives has not seen it yet", async () => {
    const v = views()
    v.client.setQueryData(queryKeys.notifications("all"), {
      pages: [page([row("x"), row("y")])],
      pageParams: [""],
    })
    const change = v.make({ kind: "read", ids: ["x"], read: true })
    await v.poll([row("x"), row("y")])
    expect(v.bellCount()).toBe(1)
    await v.commit(change)
    expect(v.rawBadge()).toBe(1)
    expect(v.bellCount()).toBe(1)
    v.unmount()
  })
})

describe("one number without a pin", () => {
  it("shows the page and the bell the same total when the badge that arrives cannot say where a changed row stands", async () => {
    const v = views()
    // The list is older than the badge: it says 119, the badge says 120 (a
    // review arrived) and has more pages; X sorts after its last row, so the
    // badge cannot say whether it has seen X's change, and no pin forms.
    v.client.setQueryData(queryKeys.notifications("all"), {
      pages: [page([row("x")], 119)],
      pageParams: [""],
    })
    const change = v.make({ kind: "read", ids: ["x"], read: true })
    await v.pollPage(
      [row("n", { openedAt: "2026-09-30T12:00:00.000Z" })],
      120,
      "more"
    )
    expect(v.pageCount()).toBe(v.bellCount())
    // Once it saves, each list holds its own answer until the refetch that
    // follows: the page's older than the badge's, so they may differ then.
    await v.commit(change)
    v.unmount()
  })
})

describe("a poll after a scope reset", () => {
  it("rests on a real answer even when the badge's update count has come round to the commit's", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const first = v.make({ kind: "read", ids: ["x"], read: true })
    const second = v.make({ kind: "read", ids: ["y"], read: true })
    await v.commit(first)
    // The query is reset and its update count starts again; the poll that
    // follows brings a review that arrived.
    await act(async () => {
      v.client.resetQueries({ queryKey: queryKeys.notifications("badge") })
      await Promise.resolve()
    })
    await v.poll([row("n"), row("y")])
    expect(v.bellCount()).toBe(1)
    await v.commit(second)
    expect(v.rawBadge()).toBe(1)
    v.unmount()
  })
})

describe("a new arrival", () => {
  it("shows a review that arrives while a read is pending, and keeps it after the commit", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const change = v.make({ kind: "read", ids: ["x"], read: true })
    // N arrives; X's save is not on the server yet.
    await v.refresh(
      [row("n"), row("x"), row("y")],
      [row("n"), row("x"), row("y")]
    )
    expect(v.bellCount()).toBe(2)
    expect(v.pageCount()).toBe(2)
    await v.commit(change)
    expect(v.rawBadge()).toBe(2)
    expect(v.bellCount()).toBe(2)
    expect(v.pageCount()).toBe(2)
    v.unmount()
  })

  it("shows a review that arrives while a change is lost and removed", async () => {
    const v = views()
    v.seed([row("x"), row("y")], [row("x"), row("y")])
    const lost = v.make({ kind: "read", ids: ["x"], read: true })
    const survivor = v.make({ kind: "resolve", ids: ["y"] })
    await v.remove(lost)
    // X saved; N arrived; Y is not resolved yet.
    await v.refresh([row("n"), read("x"), row("y")], [row("n"), row("y")])
    expect(v.bellCount()).toBe(1)
    expect(v.pageCount()).toBe(1)
    await v.commit(survivor)
    expect(v.rawBadge()).toBe(1)
    expect(v.bellCount()).toBe(1)
    expect(v.pageCount()).toBe(1)
    v.unmount()
  })
})
