"use client"

import { formatInstant } from "@/components/editors/change-diff"
import { Instant, TechnicalDetails } from "@/components/reviewed-write"
import { Card, CardContent } from "@/components/ui/card"
import { ListRow, ListRows } from "@/components/ui/list-row"
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
  none: "Google needs nothing more from you.",
  wait: "Google asks you to wait for its review.",
  verify:
    "Google asks for verification. Check the current request before starting another.",
  ownership_conflict:
    "Google reports an ownership conflict. Continue in Google to resolve access.",
  guidelines:
    "Google asks you to address its business guidelines. Follow the instructions in Google.",
  unknown:
    "We couldn’t tell what Google needs next. Check the listing in Google.",
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
  value === null ? "Not reported" : value ? "Yes" : "No"

/** The one-line answer the page leads with. */
export function verificationHeadline(confirmed: boolean | null): string {
  return confirmed === true
    ? "Verified. Google confirms you manage this listing."
    : (merchantStandingLabel(confirmed) ?? "Verification status is unknown")
}

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
          {verificationHeadline(merchant?.hasVoiceOfMerchant ?? null)}
        </p>
        <p className="text-ui text-ink-secondary">
          {merchant
            ? actionCopy[merchant.action]
            : "Google’s verification status could not be read. The request history below is a separate check."}
        </p>
        <p className="text-caption text-ink-muted">
          Last checked <Instant value={state.checkedAt} />.
        </p>
        <TechnicalDetails summary="More about this">
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
                  Verification in progress
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
              listing. Business authority is a separate signal. It does not
              show that a particular edit is live on Search or Maps; each
              change is confirmed on its own.
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
  // Read-only records drawn as list rows: method and state on the first
  // line, when it started under it, then the unknown-method code and the
  // exact reference one tap away. `interactive={false}`: the disclosure is
  // the row's only control.
  return (
    <div className="rounded-(--np-radius-card) border border-line bg-surface">
      <ListRows aria-label="Google verification request history">
        {verifications.map((item) => (
          <ListRow
            key={item.name}
            interactive={false}
            emphasis="neutral"
            title={verificationMethodName(item.method)}
            subtitle={
              item.createTime ? (
                <span className="block whitespace-normal">
                  Started <Instant value={item.createTime} />
                </span>
              ) : (
                "Start time not reported by Google"
              )
            }
            trailing={
              <StatusPill tone={phasePresentation[item.phase].tone}>
                {phasePresentation[item.phase].label}
              </StatusPill>
            }
            tags={
              <span className="flex w-full min-w-0 flex-col gap-2">
                <VerificationMethodCode method={item.method} />
                <VerificationRequestReference name={item.name} />
              </span>
            }
          />
        ))}
      </ListRows>
    </div>
  )
}
