"use client"

import { useState } from "react"
import {
  ConsentSlot,
  Expiry,
  SendBar,
  SummaryList,
  type SummaryRow,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import type { VerificationReview } from "@/lib/contracts/google-verification-review"
import { useDeadline } from "@/lib/editors/use-deadline"
import { verificationChoiceDestination } from "@/lib/locations/forms/verification"
import {
  verificationLanguageName,
  verificationMethodName,
  verificationRegionName,
} from "./verification-method"

const addressLabels: Readonly<Record<string, string>> = {
  regionCode: "Country",
  languageCode: "Address language",
  addressLines: "Street address",
  locality: "Town or city",
  administrativeArea: "County or region",
  postalCode: "Postcode",
  sublocality: "Neighbourhood",
  sortingCode: "Sorting code",
  organization: "Organisation",
  recipients: "Recipients",
  revision: "Address revision",
}
// People read the address as written; the country and language codes follow it.
const addressOrder = [
  "recipients",
  "organization",
  "addressLines",
  "sublocality",
  "locality",
  "administrativeArea",
  "postalCode",
  "sortingCode",
  "regionCode",
  "languageCode",
  "revision",
]

function addressValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.join(", ")
  if (key === "regionCode" && typeof value === "string")
    return verificationRegionName(value)
      ? `${verificationRegionName(value)} (${value})`
      : value
  if (key === "languageCode" && typeof value === "string")
    return verificationLanguageName(value)
      ? `${verificationLanguageName(value)} (${value})`
      : value
  return String(value)
}

/** The body of a saved start review; the page's ReviewedWritePanel supplies the heading and steps. */
export function VerificationStartReview({
  review,
  busy,
  active,
  blocked,
  uncertain,
  reportedExpired = false,
  onActivate,
  onApprove,
  onExecute,
  onCheck,
  onBack,
}: {
  readonly review: VerificationReview
  readonly busy: boolean
  readonly blocked: boolean
  readonly uncertain: boolean
  readonly onApprove: () => void
  readonly onExecute: () => void
  readonly onCheck: () => void
  readonly onBack: () => void
  readonly active: boolean
  readonly onActivate: () => void
  /** The server refused this review as expired, even if its recorded deadline has not passed here. */
  readonly reportedExpired?: boolean
}) {
  const [confirmed, setConfirmed] = useState(false)
  const change = review.changeSet,
    payload = review.payload
  const clockExpired = useDeadline(change.expiresAt),
    expired = clockExpired || reportedExpired
  const destination =
    payload.method === "EMAIL"
      ? payload.emailAddress
      : verificationChoiceDestination(review.choice)
  const address = payload.context?.address
  const rows: SummaryRow[] = [
    { label: "Listing", value: change.locationName },
    { label: "Method", value: verificationMethodName(payload.method) },
    { label: "Destination", value: destination },
    ...(payload.method === "ADDRESS"
      ? [{ label: "Postcard contact", value: payload.mailerContact }]
      : []),
    ...(address
      ? [
          {
            label: "Private service-business address",
            value: Object.entries(address)
              .filter(([, value]) => value !== undefined)
              .sort(
                ([a], [b]) => addressOrder.indexOf(a) - addressOrder.indexOf(b)
              )
              .map(
                ([key, value]) =>
                  `${addressLabels[key] ?? key}: ${addressValue(key, value)}`
              )
              .join("\n"),
          },
        ]
      : []),
    {
      label: "Message language",
      value:
        verificationLanguageName(payload.languageCode) ?? payload.languageCode,
    },
    {
      label: "Message language tag",
      value: payload.languageCode,
      technical: true,
    },
  ]
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-ui text-ink-secondary">
        Review this exact request. Approval does not send it to Google. A
        successful start request does not mean verification is complete.
      </p>
      <SummaryList aria-label="Verification request to send" rows={rows} />
      <Expiry
        expiresAt={change.expiresAt}
        approved={Boolean(change.approvedBy)}
        clockExpired={clockExpired}
        reportedExpired={reportedExpired}
      />
      {expired ? (
        <p role="status" className="text-ui text-danger-ink">
          {change.approvedBy
            ? "This approval has expired and the request can no longer be sent."
            : "This review has expired."}{" "}
          Check available methods and create a fresh review.
        </p>
      ) : !change.approvedBy ? (
        <>
          <p className="text-ui text-ink-secondary">
            {change.requiresSecondApprover
              ? "A different authorised owner or admin must approve this exact request. They can find it under Saved verification requests."
              : "Approve the exact destination and context before sending."}
          </p>
          <Button
            className="self-start"
            disabled={busy || blocked || !change.canApprove}
            onClick={onApprove}
          >
            Approve verification request
          </Button>
        </>
      ) : !active ? (
        <Button
          variant="secondary"
          className="self-start"
          disabled={busy}
          onClick={onActivate}
        >
          Continue approved verification start
        </Button>
      ) : (
        <>
          <p role="status" className="text-ui">
            {uncertain && !busy
              ? "The result of sending this approved request is unknown. Check the saved request outcome before any other action."
              : "This request is approved."}
          </p>
          <ConsentSlot
            label="Send this exact approved verification request to Google."
            checked={confirmed}
            disabled={busy || blocked || uncertain}
            onCheckedChange={setConfirmed}
          />
          <SendBar
            label="Approved verification request actions"
            status={
              busy
                ? "Request action in progress. Wait for a response."
                : blocked
                  ? "Sending is unavailable. Resolve the review or access issue before continuing."
                  : uncertain
                    ? "Check the saved outcome before sending again."
                    : !confirmed
                      ? "Confirm the exact approved request before sending."
                      : "Send only this exact approved request to Google."
            }
          >
            <Button
              disabled={busy || blocked || !confirmed || uncertain}
              onClick={onExecute}
            >
              Send approved verification request
            </Button>
          </SendBar>
        </>
      )}
      {uncertain && !busy && (
        <p role="status" className="text-ui text-ink-secondary">
          The response was unavailable. Check the saved outcome before taking
          another action; do not start a replacement request.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCheck}>
          Check saved request outcome
        </Button>
        <Button variant="ghost" disabled={busy || uncertain} onClick={onBack}>
          Back to methods
        </Button>
      </div>
    </div>
  )
}
