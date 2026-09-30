"use client"

import { useId, useState } from "react"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { verificationCompletionInputSchema } from "@/lib/contracts/google-verification-completion-review"

export function VerificationPinField({ name, blocked, busy, reentry = false, confirmed = true, onSubmit }: {
  readonly name: string; readonly blocked: boolean; readonly busy: boolean; readonly reentry?: boolean; readonly confirmed?: boolean
  readonly onSubmit: (pin: string) => void
}) {
  const [pin, setPin] = useState("")
  const id = useId()
  const parsed = verificationCompletionInputSchema.safeParse({ name, pin })
  const submit = <Button type="submit" className="self-start" disabled={!parsed.success || blocked || busy || !confirmed} pending={busy} pendingLabel="Request action in progress…">{reentry ? "Send approved PIN" : "Review PIN completion"}</Button>
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => {
    event.preventDefault()
    if (!parsed.success || blocked || busy || !confirmed) return
    const transient = parsed.data.pin
    setPin("")
    onSubmit(transient)
  }}>
    <Field><FieldLabel htmlFor={id}>{reentry ? "Re-enter reviewed PIN" : "PIN from Google"}</FieldLabel>
      <Input id={id} type="password" autoComplete="one-time-code" maxLength={128} value={pin} disabled={blocked || busy} onChange={(event) => setPin(event.target.value)} />
      <FieldDescription>{reentry ? "Enter the same PIN used for this exact review. A different PIN requires a fresh review and approval." : "Type Google's code exactly. Leading zeros are preserved. The PIN is cleared after preview and cannot be restored from saved work."}</FieldDescription>
    </Field>
    {reentry ? <ActionBar sticky={false} safeArea={false} label="Approved PIN completion actions" status={<ActionBarMuted>{busy ? "Request action in progress. Wait for a response." : blocked ? "Sending is unavailable. Resolve the review, access or saved-outcome issue before continuing." : !confirmed ? "Confirm this exact reviewed PIN request before sending." : !parsed.success ? "Re-enter the reviewed PIN before sending." : "Send only the PIN approved for this exact request."}</ActionBarMuted>} actions={submit} /> : submit}
  </form>
}
