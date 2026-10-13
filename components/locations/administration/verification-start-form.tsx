"use client"

import { useId, useState } from "react"
import { Instant } from "@/components/reviewed-write"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ChoiceCard } from "@/components/ui/choice-card"
import { RadioGroup } from "@/components/ui/radio-group"
import { fetchGoogleVerificationOptions } from "@/lib/api/google-verification-options"
import { verificationOptionsInputSchema, type VerificationOptionsInput, type VerificationOptionsResponse } from "@/lib/contracts/google-verification-options"
import type { VerificationReviewInput } from "@/lib/contracts/google-verification-review"
import { verificationChoiceDestination, verificationStartDraft } from "@/lib/locations/forms/verification"
import { VerificationMethodCode, verificationLanguageName, verificationMethodName } from "./verification-method"
import { cn } from "@/lib/utils"
import { CODE_INPUT_HINTS, VerificationContextFields, VerificationTextField } from "./verification-context-fields"

export function VerificationStartForm({ locationId, blocked, busy, onPreview }: {
  readonly locationId: string; readonly blocked: boolean; readonly busy: boolean
  readonly onPreview: (input: VerificationReviewInput) => void
}) {
  const [input, setInput] = useState<VerificationOptionsInput>({ languageCode: "en-GB" })
  const [options, setOptions] = useState<VerificationOptionsResponse | null>(null)
  const [selected, setSelected] = useState("")
  const [emailUser, setEmailUser] = useState(""), [mailerContact, setMailerContact] = useState("")
  const [discovering, setDiscovering] = useState(false), [error, setError] = useState<string | null>(null)
  const groupId = useId()
  const locked = busy || discovering
  const parsedInput = verificationOptionsInputSchema.safeParse(input)
  const choice = options?.options.find((item) => item.id === selected)
  const payload = choice && parsedInput.success ? verificationStartDraft(choice, parsedInput.data, { emailUser, mailerContact }) : null
  const languageName = verificationLanguageName(input.languageCode)
  const needsContext = options?.customerLocationOnly !== false && !input.context
  function update(next: VerificationOptionsInput) { setInput(next); setOptions(null); setSelected(""); setEmailUser(""); setMailerContact(""); setError(null) }
  async function discover() {
    if (!parsedInput.success || locked) return
    setDiscovering(true); setError(null); setOptions(null); setSelected("")
    try { setOptions(await fetchGoogleVerificationOptions(locationId, parsedInput.data)) }
    catch (error) {
      if (!(error instanceof Error)) throw error
      setError("Verification methods could not be checked. Reconnect if needed, then try again. No verification request was sent.")
    } finally { setDiscovering(false) }
  }
  return <div className="flex min-w-0 flex-col gap-4">
    <p className="text-ui text-ink-muted">Check the methods Google currently offers, review the exact destination, then approve before sending a request.</p>
    <Checkbox label="Provide a private service-business address" checked={Boolean(input.context)} disabled={locked} onCheckedChange={(checked) => update({ ...input, context: checked ? { address: { regionCode: "GB", addressLines: [""] } } : undefined })} />
    {input.context && <VerificationContextFields value={input.context.address} disabled={locked} onChange={(address) => update({ ...input, context: { address } })} />}
    <VerificationTextField label="Verification language" value={input.languageCode} disabled={locked} onChange={(languageCode) => update({ ...input, languageCode })} {...CODE_INPUT_HINTS}
      hint={`${languageName ? `Google writes its message in ${languageName}. ` : ""}Change the language tag only if needed, for example en-GB or cy.`} />
    {!parsedInput.success && <p role="status" className="text-caption text-ink-muted">Enter a valid language and, if supplied, country and street address before checking methods.</p>}
    <Button variant="secondary" className="self-start" disabled={locked || !parsedInput.success} onClick={() => void discover()} pending={discovering} pendingLabel="Checking methods…">Check available methods</Button>
    {error && <p role="alert" className="text-ui text-danger-ink">{error}</p>}
    {options && <>
      <p className="text-caption text-ink-muted">Methods checked <Instant value={options.checkedAt} />.</p>
      {needsContext && <p role="status" className="text-ui text-ink-secondary">Google has not confirmed that a private service-business address is unnecessary. Provide the address and check methods again before reviewing a request.</p>}
      {!options.options.length && <p role="status" className="text-ui text-ink-muted">Google returned no methods for this check. Use Google Business Profile for further instructions or check again later.</p>}
      <span id={groupId} className="text-ui font-semibold">Verification destination</span>
      <RadioGroup aria-labelledby={groupId} value={selected} disabled={locked} onValueChange={(id) => {
        const next = options.options.find((item) => item.id === id)
        setSelected(String(id)); setEmailUser(next?.kind === "email" ? next.user : ""); setMailerContact("")
      }} className="grid min-w-0 gap-3 sm:grid-cols-2">
        {options.options.map((item) => <ChoiceCard key={item.id} value={item.id} title={verificationMethodName(item.method)} description={<span className="break-words">{verificationChoiceDestination(item)}</span>}>
          <VerificationMethodCode method={item.method} />
        </ChoiceCard>)}
      </RadioGroup>
      {choice?.kind === "email" && <VerificationTextField label="Email username" value={choice.userNameEditable === true ? emailUser : choice.user} readOnly={choice.userNameEditable !== true} disabled={locked} onChange={setEmailUser} inputMode="email" {...CODE_INPUT_HINTS} hint={`Google fixes the domain to @${choice.domain}.${choice.userNameEditable === true ? " You may change the username." : " Google has not allowed username edits."}`} />}
      {choice?.kind === "phone" && <VerificationTextField label="Eligible phone destination" value={choice.phoneNumber} readOnly hint="Use this exact Google-offered destination. Correct the business profile first if it is wrong." />}
      {choice?.kind === "address" && <>
        <VerificationTextField label="Postcard contact name" value={mailerContact} disabled={locked} maxLength={200} onChange={setMailerContact} autoCapitalize="words" hint="Who should receive Google's postcard at the displayed address?" />
        <p className="text-caption text-ink-muted">{choice.expectedDeliveryDays === null ? "Google has not supplied a delivery estimate." : `Google estimates ${choice.expectedDeliveryDays} days for delivery.`}</p>
      </>}
      {choice?.kind === "external" ? <p role="status" className="text-ui text-ink-secondary">This method must be completed through Google or an authorised verification partner. NabaPresence cannot send this request.</p> : <Button className="self-start" disabled={blocked || locked || !payload || needsContext} onClick={() => { if (choice && payload && !needsContext) onPreview({ optionId: choice.id, payload }) }}>Review verification request</Button>}
    </>}
    <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "self-start")}>Open Google Business Profile</a>
  </div>
}
