"use client"

import { useState } from "react"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { onboardingMatchLinkReviewSchema } from "@/lib/contracts/google-onboarding-match-link"

export function OnboardingMatchLinkReview({ value, busy, onApprove, onLink, onRefresh, onReset }: {
  readonly value: z.infer<typeof onboardingMatchLinkReviewSchema>
  readonly busy: boolean
  readonly onApprove: () => void
  readonly onLink: () => void
  readonly onRefresh: () => void
  readonly onReset: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const conflicts = {
    external_assignment: "The provider resource has a different account or connection assignment.",
    existing_link: "This resource already has a local link, which may be inactive.",
    local_name: "The proposed local name already exists. Choose a distinct name.",
    webhook_assignment: "The resource already has a different notification routing assignment.",
  } as const
  const rows = [
    ["Google business", value.provider.title], ["Google resource", value.provider.name],
    ["Place identifier", value.provider.placeId ?? "Not supplied by Google"],
    ["Local listing name", value.localName], ["Google account", value.accountName],
    ["Client assignment", value.clientId ? "The client selected in this setup" : "No client assignment"],
    ["Verification observation", value.provider.verified === null ? "Unknown" : value.provider.verified ? "Google reports verified" : "Google reports not verified"],
    ["Provider mapping", value.externalLocationId ? "Reuse the reviewed unlinked provider record" : "Add a new provider record for this existing Google resource"],
  ] as const
  const addressLabels: Readonly<Record<string, string>> = {
    regionCode: "Country or region", addressLines: "Street address", locality: "Town or city",
    administrativeArea: "County or region", postalCode: "Postcode", languageCode: "Address language",
    organization: "Organisation", recipients: "Recipients", sortingCode: "Sorting code", revision: "Address revision",
  }
  const address = value.provider.address ? Object.entries(value.provider.address).flatMap(([key, item]) => {
    const label = addressLabels[key] ?? `Address: ${key.replace(/([a-z])([A-Z])/g, "$1 $2")}`
    if (typeof item === "string" || typeof item === "number") return [[label, String(item)]]
    if (Array.isArray(item) && item.every((line) => typeof line === "string")) return [[label, item.join(", ")]]
    return []
  }) : []
  return <>
    <p className="text-ui text-ink-muted">Review this exact mapping. Linking does not change the Google business details or create a public listing.</p>
    <dl className="divide-y divide-line rounded-(--np-radius-card) border border-line">
      {[...rows, ...address].map(([label, text]) => <div key={label} className="grid min-w-0 gap-1 p-3 sm:grid-cols-2">
        <dt className="text-caption text-ink-muted">{label}</dt><dd className="text-ui break-words whitespace-pre-wrap">{text}</dd>
      </div>)}
    </dl>
    <p className="text-caption text-ink-muted">Observed {new Date(value.observedAt).toLocaleString("en-GB")}. Approval expires {new Date(value.approvalExpiresAt).toLocaleString("en-GB")}.</p>
    {value.conflicts.length > 0 ? <div role="alert" className="space-y-2 text-ui">
      <p className="font-semibold">Resolve these mapping conflicts before approval.</p>
      <ul className="list-disc space-y-1 pl-5">{value.conflicts.map((code) => <li key={code}>{conflicts[code]}</li>)}</ul>
    </div> : !value.approvedBy ? <>
      <p className="text-ui">{value.requiresSecondApprover ? "A different authorised owner or admin must approve this exact mapping. Share this setup link with them." : "Approve this exact mapping before linking."}</p>
      <Button className="self-start" disabled={busy || !value.canApprove} onClick={onApprove}>Approve existing listing link</Button>
    </> : <>
      <p role="status" className="text-ui">This mapping is approved.</p>
      <Checkbox label="Link this existing Google resource to the reviewed local listing." checked={confirmed} disabled={busy} onCheckedChange={setConfirmed} />
      <Button className="self-start" disabled={busy || !confirmed} onClick={onLink}>Link approved existing listing</Button>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={onRefresh}>Refresh link review</Button>
      <Button variant="ghost" disabled={busy} onClick={onReset}>Start a fresh link review</Button>
    </div>
  </>
}
