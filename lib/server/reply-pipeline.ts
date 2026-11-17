import "server-only"

import type { ReplyCorrection } from "@/lib/domain/reply-policy"
import type { VerificationReason } from "@/lib/domain/verification"
import type { AiUsage } from "@/lib/server/ai"
import type { SemanticOutcome } from "@/lib/server/drafts"

/**
 * Generate → check → correct, a bounded number of times.
 *
 * A generated reply is checked before anyone sees it: the rule checks first
 * (free), then the AI verification pass. When a check finds something, the
 * reply is written again with the findings as instructions, and checked
 * again. The loop stops at the first clean reply, at `MAX_REPLY_ATTEMPTS`,
 * or when the request has no time left for another round.
 *
 * Provider usage is the caller's to record: it sees every call through the
 * functions it passes in, and reserves token capacity for each correction
 * round in `startAnother` (lib/server/review-drafts.ts).
 *
 * What comes out is the best attempt together with ITS verdict. A reply
 * that still fails after the last attempt is returned as failing, and is
 * stored and shown as blocked: nothing here turns a failure into a pass.
 */

/** One first draft and at most two corrections. */
export const MAX_REPLY_ATTEMPTS = 3

/**
 * Notes that are worth one rewrite of a generated reply, though they would
 * not stop a person publishing their own words.
 */
const REWRITE_ONCE_FOR = new Set([
  "stock_phrase",
  "exclamation_overuse",
  "generic_reply",
  "reply_repeated_opening",
  "reply_long",
  "language_mismatch",
  "tone_mismatch",
  "complaint_not_acknowledged",
])

export type GeneratedReply = {
  reply: string
  language: string
  usage: AiUsage
  model: string
}

export type ReplyAttempt = {
  reply: string
  language: string
  /** Rule and semantic reasons found before storing. */
  reasons: VerificationReason[]
  semantic: SemanticOutcome
}

export type CheckedReply = ReplyAttempt & {
  model: string
  /** How many replies were generated (1 when the first one was clean). */
  attempts: number
  /** Every attempt's reasons, oldest first, for the audit record. */
  history: { codes: string[] }[]
}

function fails(reasons: VerificationReason[]): number {
  return reasons.filter((reason) => reason.severity === "fail").length
}

/**
 * Lower is better: failures first, then a reply the AI pass could not
 * check (it would be stored `pending` and could not be published, so it
 * never outranks a checked reply that passed), then notes.
 */
function score(attempt: ReplyAttempt): number {
  return (
    fails(attempt.reasons) * 100 +
    (attempt.semantic.status === "unavailable" ? 50 : 0) +
    attempt.reasons.length
  )
}

export async function writeCheckedReply(deps: {
  generate: (correction: ReplyCorrection | null) => Promise<GeneratedReply>
  /** The deterministic checks, on text not yet stored. */
  ruleChecks: (body: string) => VerificationReason[]
  semantic: (body: string) => Promise<SemanticOutcome>
  /**
   * Asked before each correction round: whether there is time for it and,
   * for the caller's ledger, token capacity reserved for its calls. False
   * ends the loop with the attempts already checked.
   */
  startAnother: () => Promise<boolean>
  maxAttempts?: number
}): Promise<CheckedReply> {
  const maxAttempts = deps.maxAttempts ?? MAX_REPLY_ATTEMPTS
  const attempts: ReplyAttempt[] = []
  let model = ""
  let correction: ReplyCorrection | null = null
  let rewroteForNotes = false

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let generated: GeneratedReply
    try {
      generated = await deps.generate(correction)
    } catch (error) {
      // The first draft failing is the request failing. A correction that
      // could not be written leaves the attempts already checked.
      if (attempts.length === 0) throw error
      break
    }
    model = generated.model

    const ruleReasons = deps.ruleChecks(generated.reply)
    // A reply the rules refuse is rewritten without paying for the AI pass.
    // On the last round the pass still does not run: the rules have already
    // failed it, and the stored record says only the rules were applied.
    const semantic: SemanticOutcome =
      fails(ruleReasons) > 0
        ? { status: "skipped", reasons: [] }
        : await deps.semantic(generated.reply)
    const reasons = [...ruleReasons, ...semantic.reasons]
    attempts.push({
      reply: generated.reply,
      language: generated.language,
      reasons,
      semantic,
    })

    // The verifier being down says nothing about the reply.
    if (semantic.status === "unavailable") break
    const failed = fails(reasons) > 0
    const notes =
      !failed &&
      !rewroteForNotes &&
      reasons.some((reason) => REWRITE_ONCE_FOR.has(reason.code))
    if (!failed && !notes) break
    if (attempt === maxAttempts || !(await deps.startAnother())) break
    if (notes) rewroteForNotes = true
    correction = {
      previousReply: generated.reply,
      problems: reasons.map((reason) => reason.message),
    }
  }

  // The best attempt; the later one when two are as good as each other.
  const best = attempts.reduce((chosen, candidate) =>
    score(candidate) <= score(chosen) ? candidate : chosen
  )
  return {
    ...best,
    model,
    attempts: attempts.length,
    history: attempts.map((attempt) => ({
      codes: attempt.reasons.map((reason) => reason.code),
    })),
  }
}
