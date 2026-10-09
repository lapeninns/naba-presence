import { describe, expect, it } from "vitest"

import {
  GUIDANCE_MAX_CHARS,
  greetingName,
  replyGuidance,
} from "@/lib/inbox/reply-guidance"

const byId = (items: ReturnType<typeof replyGuidance>) =>
  Object.fromEntries(items.map((item) => [item.id, item.met]))

describe("greetingName", () => {
  it("takes the first word of a real name", () => {
    expect(greetingName("Sarah Whitfield", false)).toBe("Sarah")
  })

  it("gives nothing for anonymous reviewers, initials or handles", () => {
    expect(greetingName("Sarah Whitfield", true)).toBeNull()
    expect(greetingName(null, false)).toBeNull()
    expect(greetingName("J. Smith", false)).toBeNull()
    expect(greetingName("foodie_42", false)).toBeNull()
  })
})

describe("replyGuidance", () => {
  it("ticks the name only as a whole word, in any case, beyond ASCII", () => {
    expect(
      byId(
        replyGuidance({
          body: "Thank you, sarah.",
          reviewerName: "Sarah",
          rating: 5,
        })
      ).name
    ).toBe(true)
    expect(
      byId(
        replyGuidance({
          body: "Thanks, Sarahs team",
          reviewerName: "Sarah",
          rating: 5,
        })
      ).name
    ).toBe(false)
    expect(
      byId(
        replyGuidance({ body: "Merci, Zoë !", reviewerName: "Zoë", rating: 5 })
      ).name
    ).toBe(true)
  })

  it("leaves the name out when there is no name to greet", () => {
    const ids = replyGuidance({
      body: "Thanks",
      reviewerName: null,
      rating: 5,
    }).map((item) => item.id)
    expect(ids).not.toContain("name")
  })

  it("asks for a next step on three stars or fewer only", () => {
    const low = replyGuidance({
      body: "Sorry. Please call the pub and ask for the manager.",
      reviewerName: null,
      rating: 2,
    })
    expect(byId(low)["next-step"]).toBe(true)
    expect(
      byId(
        replyGuidance({
          body: "Sorry about that.",
          reviewerName: null,
          rating: 3,
        })
      )["next-step"]
    ).toBe(false)
    expect(
      replyGuidance({ body: "Thanks", reviewerName: null, rating: 4 }).map(
        (i) => i.id
      )
    ).not.toContain("next-step")
  })

  it("counts an empty or over-long reply as not meeting the length", () => {
    expect(
      byId(replyGuidance({ body: "  ", reviewerName: null, rating: 5 })).length
    ).toBe(false)
    expect(
      byId(
        replyGuidance({
          body: "a".repeat(GUIDANCE_MAX_CHARS + 1),
          reviewerName: null,
          rating: 5,
        })
      ).length
    ).toBe(false)
    expect(
      byId(replyGuidance({ body: "Thank you.", reviewerName: null, rating: 5 }))
        .length
    ).toBe(true)
  })
})
