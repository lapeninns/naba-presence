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
  /** Provider usage summed over every generation call. */
  generationUsage: AiUsage
  /** Provider usage summed over every verification call, when any ran. */
  verifyUsage?: AiUsage
  verifyModel?: string
}

export function addUsage(a: AiUsage | undefined, b: AiUsage | undefined) {
  if (!a) return b
  if (!b) return a
  const sum = (x: number | null, y: number | null) =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0)
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
  }
}

function fails(reasons: VerificationReason[]): number {
  return reasons.filter((reason) => reason.severity === "fail").length
}

/** Lower is better: failures first, then notes. */
function score(attempt: ReplyAttempt): number {
  return fails(attempt.reasons) * 100 + attempt.reasons.length
}

export async function writeCheckedReply(deps: {
  generate: (correction: ReplyCorrection | null) => Promise<GeneratedReply>
  /** The deterministic checks, on text not yet stored. */
  ruleChecks: (body: string) => VerificationReason[]
  semantic: (body: string) => Promise<SemanticOutcome>
  /** Whether the request has time for another generate and check. */
  hasTimeForAnother: () => boolean
  maxAttempts?: number
}): Promise<CheckedReply> {
  const maxAttempts = deps.maxAttempts ?? MAX_REPLY_ATTEMPTS
  const attempts: ReplyAttempt[] = []
  let generationUsage: AiUsage | undefined
  let verifyUsage: AiUsage | undefined
  let verifyModel: string | undefined
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
    generationUsage = addUsage(generationUsage, generated.usage)
    model = generated.model

    const ruleReasons = deps.ruleChecks(generated.reply)
    // A reply the rules refuse is rewritten without paying for the AI pass.
    // On the last round the pass still does not run: the rules have already
    // failed it, and the stored record says only the rules were applied.
    const semantic: SemanticOutcome =
      fails(ruleReasons) > 0
        ? { status: "skipped", reasons: [] }
        : await deps.semantic(generated.reply)
    if (semantic.usage) {
      verifyUsage = addUsage(verifyUsage, semantic.usage)
      verifyModel = semantic.model ?? verifyModel
    }
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
    if (attempt === maxAttempts || !deps.hasTimeForAnother()) break
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
    generationUsage: generationUsage ?? {
      inputTokens: null,
      outputTokens: null,
    },
    verifyUsage,
    verifyModel,
  }
}
