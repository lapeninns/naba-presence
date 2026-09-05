"use client"

import { useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { GroupedList } from "@/components/ui/grouped-list"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runAdministrationOperation } from "@/lib/api/location-administration"
import {
  verificationMethodLabel,
  verificationStateLabel,
} from "@/lib/locations/console-labels"
import {
  asArray,
  asString,
  type RawRecord,
} from "@/lib/locations/google-values"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

import { SectionGateNote, useAdministrationSection } from "./context"

// --- Verification history --------------------------------------------------
export function VerificationHistory({ data }: { data: RawRecord }) {
  const verifications = asArray(data.verifications)
  if (verifications.length === 0) {
    return (
      <p className="text-caption text-ink-muted">No verification attempts yet.</p>
    )
  }
  return (
    <GroupedList aria-label="Verification attempts">
      {verifications.map((verification, index) => (
        <VerificationRow
          key={asString(verification.name) || index}
          verification={verification}
        />
      ))}
    </GroupedList>
  )
}

function verificationBadgeVariant(
  state: string
): "success" | "info" | "destructive" | "secondary" {
  if (state === "COMPLETED") return "success"
  if (state === "PENDING") return "info"
  if (state === "FAILED") return "destructive"
  return "secondary"
}

/**
 * One attempt as a grouped-list row. A pending attempt grows a PIN field and
 * its confirm button under the title, so the row is hand-built rather than a
 * `GroupedListItem`: the label and trailing slots there are inline spans.
 */
function VerificationRow({ verification }: { verification: RawRecord }) {
  const { locationId, disabled, writeBlocked } = useAdministrationSection()
  const method =
    asString(verification.method) || asString(verification.verificationMethod)
  const state = asString(verification.state)
  const name = asString(verification.name)
  const [pin, setPin] = useState("")
  const pinId = useId()

  const complete = useResourceMutation({
    mutationFn: () =>
      runAdministrationOperation(locationId, {
        operation: "complete_verification",
        payload: { name, pin },
      }),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Verification completed",
    onSuccess: () => setPin(""),
  })

  return (
    <li className="flex min-h-(--np-row-h) flex-col justify-center gap-3 border-t border-line-subtle px-(--np-card-pad) py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body text-ink">
          {verificationMethodLabel(method)}
        </span>
        <Badge variant={verificationBadgeVariant(state)}>
          {verificationStateLabel(state)}
        </Badge>
      </div>
      {state === "PENDING" && name ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-40">
            <FieldLabel htmlFor={pinId}>PIN</FieldLabel>
            <Input
              id={pinId}
              value={pin}
              disabled={disabled}
              inputMode="numeric"
              autoComplete="one-time-code"
              onChange={(e) => setPin(e.target.value)}
            />
          </Field>
          <Button
            onClick={() => complete.mutate()}
            disabled={writeBlocked || !pin.trim() || complete.isPending}
          >
            {complete.isPending ? "Confirming…" : "Complete verification"}
          </Button>
        </div>
      ) : null}
      <SectionGateNote />
    </li>
  )
}

// --- Start a new verification ----------------------------------------------
function availableMethods(data: RawRecord): string[] {
  return Array.from(
    new Set(
      asArray(data.options)
        .map((o) => asString(o.verificationMethod))
        .filter(Boolean)
    )
  )
}

export function StartVerification({ data }: { data: RawRecord }) {
  const { locationId, disabled, writeBlocked } = useAdministrationSection()
  const methods = availableMethods(data)
  const methodLabelId = useId()
  // Only reset the selected method when `data` itself changes identity (a
  // refetch), not on every incidental re-render.
  const [method, setMethod] = useResetOnRevision(methods[0] ?? "", data)

  const start = useResourceMutation({
    mutationFn: () =>
      runAdministrationOperation(locationId, {
        operation: "start_verification",
        payload: { method, languageCode: "en" },
      }),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Verification started",
  })

  if (methods.length === 0) {
    return (
      <p className="text-caption text-ink-muted">
        Google has no verification methods available for this listing right now.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
      <div className="flex flex-col gap-1.5">
        <span id={methodLabelId} className="text-ui font-medium text-ink">
          Verification method
        </span>
        <Select
          value={method}
          onValueChange={(value: string | null) => value && setMethod(value)}
          disabled={disabled}
        >
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label="Verification method"
            aria-describedby={methodLabelId}
          >
            <SelectValue>
              {(value: string | null) =>
                value ? verificationMethodLabel(value) : ""
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {methods.map((m) => (
              <SelectItem key={m} value={m}>
                {verificationMethodLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Button
          onClick={() => start.mutate()}
          disabled={writeBlocked || start.isPending}
        >
          {start.isPending ? "Starting…" : "Start verification"}
        </Button>
      </div>
      <SectionGateNote />
    </div>
  )
}
