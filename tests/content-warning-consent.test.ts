import type { TransactionSql } from "postgres"
import { describe, expect, it } from "vitest"

import { contentWarningFromError } from "@/lib/api/content-warnings"
import { ApiClientError } from "@/lib/api/client"
import { assertBulkPostContent } from "@/lib/server/bulk-families/posts"
import {
  assertContentChecks,
  contentWarningConsent,
} from "@/lib/server/content-checks"
import { ApiError } from "@/lib/server/http"

/**
 * The two reads assertContentChecks makes (the organisation's banned
 * phrases, the listing's timezone), answered without a database.
 */
function fakeSql(bannedPhrases: string[] = []): TransactionSql {
  return (async (strings: TemplateStringsArray) =>
    strings.join("?").includes("banned_phrases")
      ? [{ bannedPhrases }]
      : [{ timezone: "Europe/London" }]) as unknown as TransactionSql
}

const offer = (summary: string, endDate: string) => {
  const [year, month, day] = endDate.split("-").map(Number)
  return {
    kind: "post" as const,
    body: summary,
    offerEndDate: endDate,
    event: { schedule: { endDate: { year, month, day } } },
  }
}

async function refusal(run: () => Promise<unknown>): Promise<ApiError> {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

async function consentFor(
  input: Parameters<typeof assertContentChecks>[1],
  sql = fakeSql()
) {
  const error = await refusal(() => assertContentChecks(sql, input))
  expect(error.code).toBe("content_warning_acknowledgement_required")
  return (error.details as { contentWarningAcknowledgement: string })
    .contentWarningAcknowledgement
}

describe("content-warning consent (S4 integration)", () => {
  it("binds the text, the policy and the warnings, not the offer dates", async () => {
    const summary = "Two for one on Tuesdays!!!"
    // A repeating schedule's occurrences move the offer's dates by the
    // template's offsets; one consent covers each of them.
    const first = await consentFor(offer(summary, "2099-01-10"))
    const later = await consentFor(offer(summary, "2099-02-14"))
    expect(later).toBe(first)
    await expect(
      assertContentChecks(fakeSql(), {
        ...offer(summary, "2099-03-21"),
        contentWarningAcknowledgement: first,
      })
    ).resolves.toBe(first)
  })

  it("is stale once the text, the warnings or the policy change", async () => {
    const token = await consentFor({ kind: "post", body: "Quiz night!!!" })
    for (const [body, sql] of [
      // Different text, same warning.
      ["Quiz night tonight!!!", fakeSql()],
      // Same text, another warning added.
      ["QUIZ NIGHT TONIGHT!!!", fakeSql()],
      // Same text and warning, the organisation's policy changed.
      ["Quiz night!!!", fakeSql(["valued customer"])],
    ] as const) {
      const error = await refusal(() =>
        assertContentChecks(sql, {
          kind: "post",
          body,
          contentWarningAcknowledgement: token,
        })
      )
      expect(error.code).toBe("content_warning_acknowledgement_required")
      expect(
        (error.details as { contentWarningAcknowledgement: string })
          .contentWarningAcknowledgement
      ).not.toBe(token)
    }
  })

  it("never lets a consent pass a fail", async () => {
    const token = contentWarningConsent({
      kind: "post",
      allowEmpty: false,
      body: "Call 01223 456789 now!!!",
      bannedPhrases: [],
      warnings: [],
    })
    const error = await refusal(() =>
      assertContentChecks(fakeSql(), {
        kind: "post",
        body: "Call 01223 456789 now!!!",
        contentWarningAcknowledgement: token,
      })
    )
    expect(error.code).toBe("content_checks_failed")
  })
})

describe("bulk post drafts at preview (S4 integration)", () => {
  const draft = (summary: string, contentWarningAcknowledgement?: string) => ({
    operation: "post_draft" as const,
    post: {
      topicType: "STANDARD" as const,
      languageCode: "en-GB",
      summary,
      media: [],
      ...(contentWarningAcknowledgement
        ? { contentWarningAcknowledgement }
        : {}),
    },
  })

  it("names the change whose warnings need acknowledging, and accepts the consent", async () => {
    const items = [draft("All welcome tonight."), draft("Quiz night!!!")]
    const error = await refusal(() => assertBulkPostContent(fakeSql(), items))
    expect(error.status).toBe(409)
    expect(error.code).toBe("content_warning_acknowledgement_required")
    const details = error.details as {
      item: number
      contentWarningAcknowledgement: string
      reasons: { code: string }[]
    }
    expect(details.item).toBe(1)
    expect(details.reasons).toEqual([
      expect.objectContaining({ code: "content_punctuation" }),
    ])
    // The same token a single post's save asks for: the client error helper
    // reads it, with the change it is about.
    expect(
      contentWarningFromError(
        new ApiClientError(409, error.code, error.message, details)
      )
    ).toEqual({
      token: details.contentWarningAcknowledgement,
      messages: [expect.any(String)],
      item: 1,
    })
    await expect(
      assertBulkPostContent(fakeSql(), [
        items[0],
        draft("Quiz night!!!", details.contentWarningAcknowledgement),
      ])
    ).resolves.toBeUndefined()
  })

  it("refuses a failing post draft with its index and no consent to give", async () => {
    const error = await refusal(() =>
      assertBulkPostContent(fakeSql(), [draft("See www.example.com")])
    )
    expect(error.status).toBe(422)
    expect(error.code).toBe("content_checks_failed")
    expect(error.details).toMatchObject({ item: 0 })
    expect(error.details).not.toHaveProperty("contentWarningAcknowledgement")
  })
})
