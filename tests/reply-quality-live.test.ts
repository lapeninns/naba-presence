import { writeFileSync } from "node:fs"

import { expect, it } from "vitest"

import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { stockPhrasesIn } from "@/lib/domain/reply-style"
import { deterministicVerification } from "@/lib/domain/verification"
import { generateReply } from "@/lib/server/ai"
import { runSemanticVerification } from "@/lib/server/drafts"
import { writeCheckedReply } from "@/lib/server/reply-pipeline"

import {
  REVIEW_CASES,
  SIBLING_VENUES,
  VENUE,
} from "./fixtures/reply-quality/corpus"

/**
 * Opt-in (RUN_LIVE_AI_TESTS=true): runs the real generate → check → correct
 * pipeline over the synthetic review corpus with the configured OpenAI
 * models and prints what it measured. Never publishes and never touches a
 * database. Each review gets the replies already written in this run as its
 * "recent replies", as a venue working through its inbox would.
 */
const opening = (reply: string) =>
  reply
    .trim()
    .split(/(?<=[.!?])\s+/u)[0]
    .toLowerCase()

it.skipIf(process.env.RUN_LIVE_AI_TESTS !== "true")(
  "writes a publishable reply to every kind of review",
  async () => {
    const cases = REVIEW_CASES.filter((review) => review.reviewText)
    const written: string[] = []
    const rows: {
      id: string
      verdict: "pass" | "warn" | "fail"
      attempts: number
      codes: string[]
      /** What each attempt was found to have, oldest first. */
      history: string[][]
      reply: string
    }[] = []
    let failedToGenerate = 0

    for (const review of cases) {
      const ruleChecks = (body: string) =>
        deterministicVerification({
          body,
          reviewText: review.reviewText,
          locationName: VENUE.name,
          otherLocationNames: SIBLING_VENUES,
          rating: review.rating,
          expectedLanguage: "en",
          recentPublishedReplies: written,
        })
      try {
        const checked = await writeCheckedReply({
          generate: (correction) =>
            generateReply({
              reviewText: review.reviewText,
              rating: review.rating,
              reviewerName: review.reviewerName,
              language: "en",
              venue: VENUE,
              recentReplies: written,
              correction,
            }),
          ruleChecks,
          semantic: (body) =>
            runSemanticVerification({
              body,
              reviewText: review.reviewText,
              reviewerName: review.reviewerName,
              locationName: VENUE.name,
              rating: review.rating,
              expectedLanguage: "en",
              venue: VENUE,
            }),
          hasTimeForAnother: () => true,
        })
        const fails = checked.reasons.some((r) => r.severity === "fail")
        rows.push({
          id: review.id,
          verdict: fails ? "fail" : checked.reasons.length ? "warn" : "pass",
          attempts: checked.attempts,
          codes: checked.reasons.map((reason) => reason.code),
          history: checked.history.map((entry) => entry.codes),
          reply: checked.reply,
        })
        written.unshift(checked.reply)
      } catch (error) {
        failedToGenerate++
        rows.push({
          id: review.id,
          verdict: "fail",
          attempts: 0,
          codes: [error instanceof Error ? error.message : "error"],
          history: [],
          reply: "",
        })
      }
    }

    // Star-only reviews are answered from the template, which faces the
    // same checks: the pass must not read its courtesies as claims.
    for (const review of REVIEW_CASES.filter((entry) => !entry.reviewText)) {
      const { reply } = ratingOnlyReply(
        review.rating,
        "en",
        review.reviewerName
      )
      const semantic = await runSemanticVerification({
        body: reply,
        reviewText: null,
        reviewerName: review.reviewerName,
        locationName: VENUE.name,
        rating: review.rating,
        expectedLanguage: "en",
        venue: VENUE,
      })
      const reasons = [
        ...deterministicVerification({
          body: reply,
          reviewText: null,
          locationName: VENUE.name,
          otherLocationNames: SIBLING_VENUES,
          rating: review.rating,
          expectedLanguage: "en",
          ratingOnlyTemplate: true,
        }),
        ...semantic.reasons,
      ]
      rows.push({
        id: review.id,
        verdict: reasons.some((r) => r.severity === "fail")
          ? "fail"
          : reasons.length
            ? "warn"
            : "pass",
        attempts: 1,
        codes: reasons.map((reason) => reason.code),
        history: [reasons.map((reason) => reason.code)],
        reply,
      })
    }

    const total = rows.length
    const publishable = rows.filter((row) => row.verdict !== "fail").length
    const unsupported = rows.filter((row) =>
      row.codes.some((code) =>
        ["unsupported_claim", "unsupported_commitment"].includes(code)
      )
    ).length
    const generic = rows.filter((row) =>
      row.codes.some((code) => ["generic_reply", "off_topic"].includes(code))
    ).length
    const retried = rows.filter((row) => row.attempts > 1).length
    const openings = rows
      .filter((row) => row.reply)
      .map((r) => opening(r.reply))
    const repeatedOpenings = openings.length - new Set(openings).size
    const stock = rows.filter((row) => stockPhrasesIn(row.reply).length).length
    const metrics = {
      reviews: total,
      validationPassRate: publishable / total,
      cleanPassRate: rows.filter((r) => r.verdict === "pass").length / total,
      unsupportedClaimRate: unsupported / total,
      genericOrOffTopicRate: generic / total,
      repeatedOpenings,
      repliesWithStockPhrase: stock,
      retryRate: retried / total,
      meanAttempts: rows.reduce((sum, row) => sum + row.attempts, 0) / total,
      generationFailures: failedToGenerate,
    }
    // Optional: the same figures and replies as a file, for a written record.
    if (process.env.REPLY_QUALITY_REPORT) {
      writeFileSync(
        process.env.REPLY_QUALITY_REPORT,
        JSON.stringify({ metrics, rows }, null, 2)
      )
    }
    console.log("REPLY QUALITY METRICS\n" + JSON.stringify(metrics, null, 2))
    for (const row of rows) {
      console.log(
        `\n[${row.id}] ${row.verdict} after ${row.attempts} attempt(s)` +
          (row.codes.length ? ` (${row.codes.join(", ")})` : "") +
          `\n${row.reply}`
      )
    }

    expect(failedToGenerate).toBe(0)
    expect(metrics.validationPassRate).toBeGreaterThanOrEqual(0.9)
    expect(metrics.unsupportedClaimRate).toBeLessThanOrEqual(0.1)
    expect(stock).toBe(0)
    // Every reply fits Google's limit and addresses the guest.
    for (const row of rows) {
      expect(Buffer.byteLength(row.reply, "utf8")).toBeLessThanOrEqual(4096)
      expect(row.reply).not.toMatch(/\bthe reviewer\b/iu)
    }
  },
  540_000
)
