"use client"

import { useId, useState } from "react"
import { ConsentSlot, SendBar } from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import { verificationCompletionInputSchema } from "@/lib/contracts/google-verification-completion-review"

/**
 * One visible PIN field. It is a text input (leading zeros survive) that asks
 * for the numeric keypad and offers the code Google just texted; the contract
 * still accepts any 1-128 character code, so non-digits are not rejected here.
 *
 * Why this is not an OtpField, even for the postcard (ADDRESS) method: the
 * per-character boxes need a length known up front, and Google does not
 * promise one. The verification contract and our recovery specs accept a
 * 6-character PIN for every method, ADDRESS included, so five boxes would
 * cut a valid PIN short. One input that holds any length is the safe default
 * for every method. (This departs from the F6 brief's "OtpField length 5 for
 * POSTCARD" plan, which the specs disproved; logged in the F6 ledger.)
 *
 * It lives only in this component's state: it is cleared as soon as it
 * is handed to `onSubmit` and never reaches a query or mutation cache. At the
 * send step (`reentry`) the same PIN is typed again inside the consent, so
 * nothing is restored from the preview.
 */
/** Where Google delivered the code, so the hint says where to look. */
const pinSource: Readonly<Record<string, string>> = {
  EMAIL: "Enter the code from Google’s email.",
  SMS: "Enter the code from Google’s text message.",
  PHONE_CALL: "Enter the code from Google’s phone call.",
  ADDRESS: "Enter the code from Google’s postcard.",
}

/** The preview hint: where the code is, then how it is kept. */
export function verificationPinHint(method: string | null | undefined): string {
  return `${(method && pinSource[method]) || "Enter the code Google sent you."} Leading zeros count. The PIN isn’t saved, so you’ll type it again to send.`
}

export function VerificationPinField({
  name,
  method,
  blocked,
  busy,
  reentry = false,
  consentLabel = "",
  onSubmit,
}: {
  readonly name: string
  /** Google's delivery method for this request; picks the hint. */
  readonly method?: string | null
  readonly blocked: boolean
  readonly busy: boolean
  readonly reentry?: boolean
  /** The send consent shown with the re-entered PIN. */
  readonly consentLabel?: string
  readonly onSubmit: (pin: string) => void
}) {
  const [pin, setPin] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const id = useId()
  const parsed = verificationCompletionInputSchema.safeParse({ name, pin })
  const consented = !reentry || confirmed
  const submit = (
    <Button
      type="submit"
      className="self-start"
      disabled={!parsed.success || blocked || busy || !consented}
      pending={busy}
      pendingLabel="Request action in progress…"
    >
      {reentry ? "Send approved PIN" : "Review PIN completion"}
    </Button>
  )
  const field = (
    <Field>
      <FieldLabel htmlFor={id}>
        {reentry ? "Re-enter reviewed PIN" : "PIN from Google"}
      </FieldLabel>
      <Input
        id={id}
        type="text"
        {...inputHints.oneTimeCode}
        enterKeyHint={reentry ? "send" : "go"}
        maxLength={128}
        className="tabular-nums"
        value={pin}
        disabled={blocked || busy}
        onChange={(event) => setPin(event.target.value)}
      />
      <FieldDescription>
        {reentry
          ? "Type the same PIN again. A different PIN needs a new review and approval."
          : verificationPinHint(method)}
      </FieldDescription>
    </Field>
  )
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!parsed.success || blocked || busy || !consented) return
        const transient = parsed.data.pin
        setPin("")
        onSubmit(transient)
      }}
    >
      {reentry ? (
        <>
          <ConsentSlot
            label={consentLabel}
            checked={confirmed}
            disabled={busy || blocked}
            onCheckedChange={setConfirmed}
          >
            {field}
          </ConsentSlot>
          <SendBar
            label="Approved PIN completion actions"
            status={
              busy
                ? "Request action in progress. Wait for a response."
                : blocked
                  ? "Sending is unavailable. Resolve the review, access or saved-outcome issue before continuing."
                  : !confirmed
                    ? "Confirm this exact reviewed PIN request before sending."
                    : !parsed.success
                      ? "Re-enter the reviewed PIN before sending."
                      : "Send only the PIN approved for this exact request."
            }
          >
            {submit}
          </SendBar>
        </>
      ) : (
        <>
          {field}
          {submit}
        </>
      )}
    </form>
  )
}
