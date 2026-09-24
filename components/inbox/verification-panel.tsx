"use client"

import { useId } from "react"
import {
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  MessageSquareTextIcon,
  RulerIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LatestVerification } from "@/lib/api/reviews"
import { REPLY_FOCUS_EVENT } from "@/lib/inbox/events"
import { cn } from "@/lib/utils"

type Reason = LatestVerification["reasons"][number]

/**
 * The four checks an operator sees, and which reason codes belong to each.
 *
 * The verifier (lib/domain/verification.ts and lib/server/ai.ts) emits flat
 * reason codes. The panel groups them so a blocked reply says which of four
 * things is wrong rather than listing codes. A code nobody has grouped lands
 * in the semantic card, which is the one that reads the whole reply.
 */
const CHECKS = [
  {
    id: "length",
    title: "Length",
    icon: RulerIcon,
    codes: ["empty_reply", "too_long", "too_short", "byte_limit"],
    match: (code: string) => /length|empty|byte|long|short/.test(code),
  },
  {
    id: "terms",
    title: "Banned terms",
    icon: BanIcon,
    codes: [],
    match: (code: string) =>
      /unsafe|promotion|promo|discount|claim|escalat|contact|pii|link|profan|legal|refund|compensat/.test(
        code
      ),
  },
  {
    id: "tone",
    title: "Tone match",
    icon: MessageSquareTextIcon,
    codes: [],
    match: (code: string) =>
      /tone|language_mismatch|language|name|greeting/.test(code),
  },
  {
    id: "semantic",
    title: "Semantic check",
    icon: SparklesIcon,
    codes: [],
    match: () => true,
  },
] as const

type CheckResult = {
  id: string
  title: string
  icon: typeof RulerIcon
  reasons: Reason[]
  state: "pass" | "warn" | "fail" | "pending"
}

function groupReasons(verification: LatestVerification | null): CheckResult[] {
  const remaining = [...(verification?.reasons ?? [])]
  return CHECKS.map((check) => {
    const mine: Reason[] = []
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (check.match(remaining[index].code)) {
        mine.unshift(remaining[index])
        remaining.splice(index, 1)
      }
    }
    const state: CheckResult["state"] = !verification
      ? "pending"
      : mine.some((reason) => reason.severity === "fail")
        ? "fail"
        : mine.length > 0
          ? "warn"
          : "pass"
    return {
      id: check.id,
      title: check.title,
      icon: check.icon,
      reasons: mine,
      state,
    }
  })
}

const STATE_LABEL: Record<CheckResult["state"], string> = {
  pass: "Pass",
  warn: "Check",
  fail: "Fail",
  pending: "Not run yet",
}

const STATE_ICON = {
  pass: CheckIcon,
  warn: TriangleAlertIcon,
  fail: XIcon,
  pending: CircleDashedIcon,
} as const

/**
 * Verification as four check cards and, when something is in the way, the
 * reasons in words (reference `.checks`).
 *
 * Each card names a check and its result as a word with a glyph — never the
 * colour alone. A failed check fills with the danger tint. Under the cards,
 * a blocked reply lists what stops it with a way to the draft, and a reply
 * with notes lists them; a clean one says nothing more.
 */
function VerificationChecks({
  verification,
  status,
  className,
}: {
  verification: LatestVerification | null
  status: string
  className?: string
}) {
  const headingId = useId()
  const checks = groupReasons(verification)
  const blocking = checks.flatMap((check) =>
    check.reasons.filter((reason) => reason.severity === "fail")
  )
  const warnings = checks.flatMap((check) =>
    check.reasons.filter((reason) => reason.severity === "warn")
  )
  const verdict: "ready" | "blocked" | "pending" = !verification
    ? "pending"
    : blocking.length > 0
      ? "blocked"
      : "ready"

  return (
    <section
      aria-labelledby={headingId}
      data-slot="verification-checks"
      data-verdict={verdict}
      // Focusable from the composer's "N issues to fix" caption.
      tabIndex={-1}
      className={cn(
        "flex scroll-mt-4 flex-col gap-2.5 rounded-(--np-radius-control) focus-halo focus-visible:outline-none",
        className
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id={headingId} className="text-ui font-semibold text-ink">
          Verification
        </h3>
        <p className="text-caption text-ink-muted">
          {verdict === "pending"
            ? status === "new"
              ? "Runs when you save a draft."
              : "Save or generate a draft to run the checks."
            : verdict === "blocked"
              ? "Blocked · fix the failed checks to continue"
              : warnings.length > 0
                ? `Ready to publish · ${warnings.length} ${warnings.length === 1 ? "point" : "points"} to read first`
                : "Ready to publish · every check passed on the latest draft"}
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 @[620px]/detail:grid-cols-4">
        {checks.map((check) => {
          const Icon = STATE_ICON[check.state]
          return (
            <li
              key={check.id}
              data-reveal="rise"
              data-state={check.state}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-[10px] border px-3 py-2.5",
                check.state === "fail"
                  ? "border-transparent bg-danger-tint"
                  : "border-line"
              )}
            >
              <span className="text-caption font-medium text-ink-muted">
                {check.title}
              </span>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-ui font-semibold",
                  check.state === "pass" && "text-success-ink",
                  check.state === "fail" && "text-danger-ink",
                  check.state === "warn" && "text-warning-ink",
                  check.state === "pending" && "font-medium text-ink-muted"
                )}
              >
                <Icon
                  aria-hidden
                  strokeWidth={2}
                  className="size-3.5 shrink-0"
                />
                {STATE_LABEL[check.state]}
              </span>
              {check.reasons[0] ? (
                <span className="text-caption break-words text-ink-secondary">
                  {check.reasons[0].message}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>

      {blocking.length > 0 ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-(--np-radius-card) bg-danger-tint px-3.5 py-3 text-ui text-ink">
          <CircleAlertIcon
            aria-hidden
            strokeWidth={1.75}
            className="row-span-3 mt-0.5 size-4 text-danger-ink"
          />
          <strong className="font-semibold">
            This reply can&rsquo;t be published yet
          </strong>
          <ul className="list-disc pl-[18px] text-ink-secondary">
            {blocking.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{reason.message}</li>
            ))}
          </ul>
          <div className="mt-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.dispatchEvent(new Event(REPLY_FOCUS_EVENT))}
            >
              Correct the draft
            </Button>
          </div>
        </div>
      ) : warnings.length > 0 ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-(--np-radius-card) bg-warning-tint px-3.5 py-3 text-ui text-ink">
          <TriangleAlertIcon
            aria-hidden
            strokeWidth={1.75}
            className="row-span-2 mt-0.5 size-4 text-warning-ink"
          />
          <strong className="font-semibold">
            Worth reading before you publish
          </strong>
          <ul className="list-disc pl-[18px] text-ink-secondary">
            {warnings.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{reason.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

export { VerificationChecks, groupReasons }
