"use client"

import { formatInstant } from "@/components/editors/change-diff"
import { Instant, TechnicalDetails } from "@/components/reviewed-write"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/ui/status-pill"
import type {
  ObservedMerchantState,
  ObservedVerification,
  VerificationStateResponse,
} from "@/lib/contracts/google-verification-state"
import type { StatusTone } from "@/lib/ui/status-tone"
import {
  VerificationMethodCode,
  VerificationRequestReference,
  verificationMethodName,
} from "./verification-method"

const actionCopy = {
  none: "Google reported no further merchant action.",
  wait: "Google asks you to wait for its review.",
  verify:
    "Google asks for verification. Check the current request before starting another.",
  ownership_conflict:
    "Google reports an ownership conflict. Continue in Google to resolve access.",
  guidelines:
    "Google asks you to address its business guidelines. Follow the instructions in Google.",
  unknown:
    "Google’s required merchant action is unknown. Check the listing in Google.",
} satisfies Record<ObservedMerchantState["action"], string>

const phasePresentation = {
  pending: { label: "Pending with Google", tone: "pending" },
  completed: { label: "Request completed", tone: "healthy" },
  failed: { label: "Request failed", tone: "at-risk" },
  unknown: { label: "Request state unknown", tone: "neutral" },
} satisfies Record<
  ObservedVerification["phase"],
  { label: string; tone: StatusTone }
>

/** Google's overall management confirmation in plain words; null when Google did not report it. */
export function merchantStandingLabel(
  confirmed: boolean | null
): string | null {
  return confirmed === true
    ? "Google confirms you can manage this listing"
    : confirmed === false
      ? "Google hasn't yet confirmed you can manage this listing"
      : null
}

const yesNo = (value: boolean | null) =>
  value === null ? "Unknown" : value ? "Yes" : "No"

/**
 * Google's standing for this listing: the human status and what Google asks
 * for first, then when it was read; the separate signals and caveats sit in
 * a collapsed disclosure.
 */
export function VerificationMerchantObservation({
  state,
}: {
  readonly state: VerificationStateResponse
}) {
  const merchant = state.merchant
  return (
    <Card size="sm">
      <CardContent className="flex min-w-0 flex-col gap-2">
        <p className="text-body font-semibold text-ink">
          {merchantStandingLabel(merchant?.hasVoiceOfMerchant ?? null) ??
            "Merchant standing is unknown"}
        </p>
        <p className="text-ui text-ink-secondary">
          {merchant
            ? actionCopy[merchant.action]
            : "Google’s merchant standing could not be read. Verification request history is a separate observation."}
        </p>
        <p className="text-caption text-ink-muted">
          Last checked <Instant value={state.checkedAt} />.
        </p>
        <TechnicalDetails summary="About this standing">
          {merchant && (
            <>
              <div className="grid min-w-0 gap-0.5">
                <dt className="text-caption text-ink-muted">
                  Business authority reported
                </dt>
                <dd className="text-ui text-ink">
                  {yesNo(merchant.hasBusinessAuthority)}
                </dd>
              </div>
              <div className="grid min-w-0 gap-0.5">
                <dt className="text-caption text-ink-muted">
                  Pending verification reported
                </dt>
                <dd className="text-ui text-ink">
                  {yesNo(merchant.hasPendingVerification)}
                </dd>
              </div>
            </>
          )}
          <div className="grid min-w-0 gap-0.5">
            <dt className="text-caption text-ink-muted">What this means</dt>
            <dd className="text-ui text-ink-secondary">
              This is Google’s overall confirmation that you can manage the
              listing; business authority is a separate signal. It does not
              confirm that a particular edit is published or visible on Search
              or Maps. Each operation has its own confirmation.
            </dd>
          </div>
        </TechnicalDetails>
      </CardContent>
    </Card>
  )
}

/** When the request list was read, so it never reads as contradicting a newer saved outcome. */
export function verificationCheckTime(checkedAt: string): string {
  return formatInstant(checkedAt)
}

/**
 * Google's request history as a list of records (method and state first,
 * then when it started, then the exact reference one tap away). A list, not
 * a table: it never scrolls sideways at 320px and adds no extra tab stop.
 */
export function VerificationRequestHistory({
  verifications,
  checkedAt,
}: {
  readonly verifications: readonly ObservedVerification[]
  readonly checkedAt: string
}) {
  if (!verifications.length)
    return (
      <p className="text-ui text-ink-muted">
        Google returned no verification requests when this list was checked at{" "}
        {verificationCheckTime(checkedAt)}. A saved outcome above may have been
        observed after that check; check current Google verification state to
        update this list.
      </p>
    )
  return (
    <ul
      aria-label="Google verification request history"
      className="flex min-w-0 list-none flex-col gap-2"
    >
      {verifications.map((item) => (
        <li key={item.name}>
          <Card size="sm">
            <CardContent className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="text-ui font-semibold text-ink">
                  {verificationMethodName(item.method)}
                </span>
                <StatusPill tone={phasePresentation[item.phase].tone}>
                  {phasePresentation[item.phase].label}
                </StatusPill>
              </div>
              <VerificationMethodCode method={item.method} />
              <p className="text-caption text-ink-muted">
                {item.createTime ? (
                  <>
                    Started <Instant value={item.createTime} />
                  </>
                ) : (
                  "Start time not reported by Google"
                )}
              </p>
              <VerificationRequestReference name={item.name} />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
