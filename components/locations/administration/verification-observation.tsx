"use client"

import { StatusPill } from "@/components/ui/status-pill"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ObservedMerchantState, ObservedVerification, VerificationStateResponse } from "@/lib/contracts/google-verification-state"
import { VerificationMethodCode, verificationMethodName } from "./verification-method"
import type { StatusTone } from "@/lib/ui/status-tone"

const actionCopy = {
  none: "Google reported no further merchant action.",
  wait: "Google asks you to wait for its review.",
  verify: "Google asks for verification. Check the current request before starting another.",
  ownership_conflict: "Google reports an ownership conflict. Continue in Google to resolve access.",
  guidelines: "Google asks you to address its business guidelines. Follow the instructions in Google.",
  unknown: "Google’s required merchant action is unknown. Check the listing in Google.",
} satisfies Record<ObservedMerchantState["action"], string>

const phasePresentation = {
  pending: { label: "Pending with Google", tone: "pending" },
  completed: { label: "Request completed", tone: "healthy" },
  failed: { label: "Request failed", tone: "at-risk" },
  unknown: { label: "Request state unknown", tone: "neutral" },
} satisfies Record<ObservedVerification["phase"], { label: string; tone: StatusTone }>

export function VerificationMerchantObservation({ state }: { readonly state: VerificationStateResponse }) {
  const merchant = state.merchant
  return <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4">
    <p className="text-body font-semibold text-ink">{merchant?.hasVoiceOfMerchant === true
      ? "Google reports voice of merchant"
      : merchant?.hasVoiceOfMerchant === false
        ? "Google does not report voice of merchant"
        : "Merchant standing is unknown"}</p>
    <p className="text-ui text-ink-secondary">Voice of merchant is Google’s overall merchant standing. Business authority is a separate signal.</p>
    <p className="text-ui text-ink-secondary">{merchant ? actionCopy[merchant.action] : "Google’s merchant standing could not be read. Verification request history is a separate observation."}</p>
    {merchant && <dl className="grid gap-2 text-ui sm:grid-cols-2">
      <div><dt className="text-ink-muted">Business authority reported</dt><dd>{merchant.hasBusinessAuthority === null ? "Unknown" : merchant.hasBusinessAuthority ? "Yes" : "No"}</dd></div>
      <div><dt className="text-ink-muted">Pending verification reported</dt><dd>{merchant.hasPendingVerification === null ? "Unknown" : merchant.hasPendingVerification ? "Yes" : "No"}</dd></div>
    </dl>}
    <p className="text-caption text-ink-muted">This standing does not confirm that a particular edit is published or visible on Search or Maps. Each operation has its own confirmation.</p>
    <p className="font-mono text-caption text-ink-muted">Last checked {new Date(state.checkedAt).toLocaleString("en-GB")}.</p>
  </div>
}

/** When the request list was read, so it never reads as contradicting a newer saved outcome. */
export function verificationCheckTime(checkedAt: string): string {
  return new Date(checkedAt).toLocaleString("en-GB")
}

export function VerificationRequestHistory({ verifications, checkedAt }: { readonly verifications: readonly ObservedVerification[]; readonly checkedAt: string }) {
  if (!verifications.length) return <p className="text-ui text-ink-muted">Google returned no verification requests when this list was checked at {verificationCheckTime(checkedAt)}. A saved outcome above may have been observed after that check; check current Google verification state to update this list.</p>
  return <Table surface responsive>
    <caption className="sr-only">Google verification request history</caption>
    <TableHeader><TableRow><TableHead>Method</TableHead><TableHead>Started</TableHead><TableHead>Request state</TableHead></TableRow></TableHeader>
    <TableBody>{verifications.map((item) => <TableRow key={item.name}>
      <TableCell label="Method"><span className="font-semibold">{verificationMethodName(item.method)}</span><VerificationMethodCode method={item.method} /><p className="font-mono text-caption break-all text-ink-muted">{item.name}</p></TableCell>
      <TableCell label="Started" className="font-mono text-caption">{item.createTime ? new Date(item.createTime).toLocaleString("en-GB") : "Unknown"}</TableCell>
      <TableCell label="Request state"><StatusPill tone={phasePresentation[item.phase].tone}>{phasePresentation[item.phase].label}</StatusPill></TableCell>
    </TableRow>)}</TableBody>
  </Table>
}
