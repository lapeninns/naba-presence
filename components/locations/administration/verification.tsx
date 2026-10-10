"use client"

import { StatusPill } from "@/components/ui/status-pill"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { observedVerificationSchema } from "@/lib/contracts/google-verification-state"
import { formatRelativeTime } from "@/lib/format"
import { verificationStateLabel } from "@/lib/locations/console-labels"
import { asArray, asString, type RawRecord } from "@/lib/locations/google-values"
import type { StatusTone } from "@/lib/ui/status-tone"
import { ReviewedCompletionVerification } from "./verification-completion"
import { VerificationMethodCode, verificationMethodName } from "./verification-method"

export function pendingVerifications(data: RawRecord): RawRecord[] {
  return asArray(data.verifications).filter((item) => asString(item.state) === "PENDING" && Boolean(asString(item.name)))
}

function methodOf(item: RawRecord): string {
  return asString(item.method) || asString(item.verificationMethod)
}

function stateTone(state: string): StatusTone {
  if (state === "COMPLETED") return "healthy"
  if (state === "PENDING") return "pending"
  if (state === "FAILED") return "at-risk"
  return "neutral"
}

/** Transitional adapter for the old read bundle; completion has fresh server preflight. */
export function PendingVerifications({ data }: { readonly data: RawRecord }) {
  const verifications = asArray(data.verifications).flatMap((item) => {
    const state = asString(item.state), timestamp = observedVerificationSchema.shape.createTime.safeParse(asString(item.createTime) || null)
    const parsed = observedVerificationSchema.safeParse({
      name: asString(item.name), method: methodOf(item) || null, providerState: state || null,
      phase: state === "PENDING" ? "pending" : state === "COMPLETED" ? "completed" : state === "FAILED" ? "failed" : "unknown",
      createTime: timestamp.success ? timestamp.data : null,
    })
    return parsed.success ? [parsed.data] : []
  })
  return <ReviewedCompletionVerification verifications={verifications} />
}

export function VerificationHistory({ data, includePending = true }: { readonly data: RawRecord; readonly includePending?: boolean }) {
  const verifications = asArray(data.verifications)
  return <div className="flex flex-col gap-3">
    {includePending && <PendingVerifications data={data} />}
    {!verifications.length ? <p className="text-ui text-ink-muted">No verification attempts yet.</p> : <Table surface responsive>
      <caption className="sr-only">Verification attempts</caption>
      <TableHeader><TableRow><TableHead>Method</TableHead><TableHead>Started</TableHead><TableHead>State</TableHead></TableRow></TableHeader>
      <TableBody>{verifications.map((item, index) => {
        const state = asString(item.state), created = asString(item.createTime)
        return <TableRow key={asString(item.name) || index}>
          <TableCell label="Method" className="font-semibold">{verificationMethodName(methodOf(item))}<VerificationMethodCode method={methodOf(item)} /></TableCell>
          <TableCell label="Started"><span className="font-mono text-caption text-ink-muted">{created ? formatRelativeTime(created) : "—"}</span></TableCell>
          <TableCell label="State"><StatusPill tone={stateTone(state)}>{state === "PENDING" ? "Pending with Google" : verificationStateLabel(state)}</StatusPill></TableCell>
        </TableRow>
      })}</TableBody>
    </Table>}
  </div>
}

export { ReviewedStartVerification as StartVerification } from "./verification-start"
