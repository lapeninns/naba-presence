"use client"

import { CircleAlert } from "lucide-react"
import { useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ChoiceCard } from "@/components/ui/choice-card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup } from "@/components/ui/radio-group"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiClientError } from "@/lib/api/client"
import { runAdministrationOperation } from "@/lib/api/location-administration"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatRelativeTime } from "@/lib/format"
import {
  verificationMethodLabel,
  verificationStateLabel,
} from "@/lib/locations/console-labels"
import {
  asArray,
  asRecord,
  asString,
  type RawRecord,
} from "@/lib/locations/google-values"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import type { StatusTone } from "@/lib/ui/status-tone"

import { SectionGateNote, useAdministrationSection } from "./context"

/** The attempts Google has on record, pending ones first. */
export function pendingVerifications(data: RawRecord): RawRecord[] {
  return asArray(data.verifications).filter(
    (verification) =>
      asString(verification.state) === "PENDING" &&
      Boolean(asString(verification.name))
  )
}

function stateTone(state: string): StatusTone {
  if (state === "COMPLETED") return "healthy"
  if (state === "PENDING") return "pending"
  if (state === "FAILED") return "at-risk"
  return "neutral"
}

function stateWord(state: string): string {
  return state === "PENDING" ? "Waiting for PIN" : verificationStateLabel(state)
}

function methodOf(verification: RawRecord): string {
  return (
    asString(verification.method) || asString(verification.verificationMethod)
  )
}

// --- Enter the PIN -------------------------------------------------------
/**
 * One pending attempt: where Google sent the PIN, and the field to type it
 * into. Completing it is a Google write; the button stays disabled until a
 * PIN is typed and while the write is in flight.
 */
function PinEntry({ verification }: { verification: RawRecord }) {
  const { locationId, disabled, writeBlocked } = useAdministrationSection()
  const method = methodOf(verification)
  const name = asString(verification.name)
  const created = asString(verification.createTime)
  const [pin, setPin] = useState("")
  // Google's answer to the last attempt, kept beside the field (not only in a
  // toast) so the operator can read it while retyping the PIN.
  const [pinError, setPinError] = useState<{
    message: string
    code: string | null
  } | null>(null)
  const pinRef = useRef<HTMLInputElement>(null)
  const pinId = useId()
  const hintId = useId()
  const errorId = useId()
  const headingId = useId()

  const complete = useResourceMutation({
    mutationFn: () =>
      runAdministrationOperation(locationId, {
        operation: "complete_verification",
        payload: { name, pin },
      }),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Verification completed",
    errorToast: (error) =>
      pinRejected(error)
        ? "Google didn’t accept the PIN"
        : describeActionError(error),
    onSuccess: () => {
      setPin("")
      setPinError(null)
    },
    onError: (error, message) => {
      setPinError(
        pinRejected(error)
          ? {
              message:
                "Google didn’t accept this PIN. Nothing changed. Check it against Google’s message and try again.",
              code: error.code,
            }
          : { message, code: null }
      )
      // The submit button was disabled while the request ran, so focus has
      // nowhere to go; put it back in the field the operator fixes next.
      pinRef.current?.focus()
    },
  })

  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-line p-4 first:border-t-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span id={headingId} className="text-body font-semibold text-ink">
          {verificationMethodLabel(method)}
        </span>
        <StatusPill tone="pending">Waiting for PIN</StatusPill>
        {created ? (
          <span className="font-mono text-caption text-ink-muted">
            Started {formatRelativeTime(created)}
          </span>
        ) : null}
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!writeBlocked && pin.trim() && !complete.isPending)
            complete.mutate()
        }}
      >
        <Field className="w-full max-w-[12.5rem]">
          <FieldLabel htmlFor={pinId}>PIN</FieldLabel>
          <Input
            ref={pinRef}
            id={pinId}
            value={pin}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-invalid={pinError ? true : undefined}
            aria-describedby={pinError ? `${errorId} ${hintId}` : hintId}
            className="font-mono tracking-[0.3em]"
            onChange={(event) => {
              setPin(event.target.value.replace(/\s+/g, ""))
              setPinError(null)
            }}
          />
        </Field>
        <Button
          type="submit"
          disabled={writeBlocked || !pin.trim() || complete.isPending}
          aria-busy={complete.isPending || undefined}
        >
          {complete.isPending ? "Confirming…" : "Complete verification"}
        </Button>
      </form>
      {pinError ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-caption font-medium text-danger-ink"
        >
          <CircleAlert
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-3.5 shrink-0"
          />
          <span className="min-w-0">
            {pinError.message}
            {pinError.code ? (
              <>
                {" "}
                <code className="inline-block max-w-full rounded-(--np-radius-tag) border border-line bg-surface px-1.5 font-mono break-all text-ink-secondary">
                  {pinError.code}
                </code>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
      <p id={hintId} className="text-caption text-ink-muted">
        Type the code exactly as Google sent it. NabaPresence sends it to Google
        and shows Google’s answer.
      </p>
      <SectionGateNote />
    </li>
  )
}

/**
 * Google itself refused the PIN: a 400 carrying Google's canonical status
 * (INVALID_ARGUMENT, FAILED_PRECONDITION…), which the transport passes through
 * as the code. NabaPresence's own codes are lower case, so a request the app
 * rejected, or one that never reached Google, keeps its usual copy.
 */
function pinRejected(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.status === 400 &&
    /^[A-Z][A-Z_]+$/.test(error.code)
  )
}

/** Every attempt that is waiting for its PIN, as one card. */
export function PendingVerifications({ data }: { data: RawRecord }) {
  const pending = pendingVerifications(data)
  if (pending.length === 0) return null
  return (
    <ul
      aria-label="Verifications waiting for a PIN"
      className="flex list-none flex-col rounded-(--np-radius-card) border border-line bg-surface"
    >
      {pending.map((verification) => (
        <PinEntry
          key={asString(verification.name)}
          verification={verification}
        />
      ))}
    </ul>
  )
}

// --- Verification history --------------------------------------------------
/**
 * Every attempt Google has on record, as a table (labelled rows on a narrow
 * screen). With `includePending` (the default) the PIN entry for a pending
 * attempt is drawn above the table, so the one action the history asks for
 * is never separated from it.
 */
export function VerificationHistory({
  data,
  includePending = true,
}: {
  data: RawRecord
  includePending?: boolean
}) {
  const verifications = asArray(data.verifications)
  if (verifications.length === 0) {
    return (
      <p className="text-ui text-ink-muted">No verification attempts yet.</p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {includePending ? <PendingVerifications data={data} /> : null}
      <Table surface responsive>
        <caption className="sr-only">Verification attempts</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Method</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {verifications.map((verification, index) => {
            const state = asString(verification.state)
            const created = asString(verification.createTime)
            return (
              <TableRow key={asString(verification.name) || index}>
                <TableCell label="Method" className="font-semibold">
                  {verificationMethodLabel(methodOf(verification))}
                </TableCell>
                <TableCell label="Started">
                  <span className="font-mono text-caption text-ink-muted">
                    {created ? formatRelativeTime(created) : "—"}
                  </span>
                </TableCell>
                <TableCell label="State">
                  <StatusPill tone={stateTone(state)}>
                    {stateWord(state)}
                  </StatusPill>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// --- Start a new verification ----------------------------------------------
type MethodOption = { method: string; destination: string | null }

/** Google's options, one per method, with where the PIN would go. */
function availableMethods(data: RawRecord): MethodOption[] {
  const seen = new Map<string, MethodOption>()
  for (const option of asArray(data.options)) {
    const method = asString(option.verificationMethod)
    if (!method || seen.has(method)) continue
    const email = asRecord(option.emailData)
    const address = asRecord(option.addressData)
    const destination =
      asString(option.phoneNumber) ||
      (asString(email.user) && asString(email.domain)
        ? `${asString(email.user)}@${asString(email.domain)}`
        : asString(email.domain)) ||
      asString(address.business) ||
      null
    seen.set(method, { method, destination })
  }
  return [...seen.values()]
}

const METHOD_NOTE: Record<string, string> = {
  ADDRESS: "Google posts a PIN. It can take a couple of weeks to arrive.",
  PHONE_CALL: "An automated call reads out the PIN.",
  SMS: "A text message with the PIN.",
  EMAIL: "An email from Google with the PIN.",
}

export function StartVerification({ data }: { data: RawRecord }) {
  const { locationId, disabled, writeBlocked } = useAdministrationSection()
  const methods = availableMethods(data)
  const legendId = useId()
  // Only reset the selected method when `data` itself changes identity (a
  // refetch), not on every incidental re-render.
  const [method, setMethod] = useResetOnRevision(methods[0]?.method ?? "", data)

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
      <p className="text-ui text-ink-muted">
        Google has no verification methods available for this listing right now.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span id={legendId} className="text-ui font-semibold text-ink">
          Verification method
        </span>
        <RadioGroup
          aria-labelledby={legendId}
          value={method}
          onValueChange={(value) => setMethod(String(value))}
          disabled={disabled || start.isPending}
          className="grid grid-cols-1 gap-3 @[620px]:grid-cols-2"
        >
          {methods.map((option) => (
            <ChoiceCard
              key={option.method}
              value={option.method}
              title={verificationMethodLabel(option.method)}
              description={METHOD_NOTE[option.method]}
            >
              {option.destination ? (
                <span className="mt-0.5 font-mono text-caption break-all text-ink-secondary">
                  {option.destination}
                </span>
              ) : null}
            </ChoiceCard>
          ))}
        </RadioGroup>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => start.mutate()}
          disabled={writeBlocked || !method || start.isPending}
          aria-busy={start.isPending || undefined}
        >
          {start.isPending ? "Starting…" : "Start verification"}
        </Button>
        {start.isPending ? (
          <span role="status" className="text-ui text-ink-muted">
            Sent to Google — waiting for its answer
          </span>
        ) : null}
      </div>
      <SectionGateNote />
    </div>
  )
}
