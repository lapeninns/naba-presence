"use client"

import { useId, useState } from "react"
import { Instant } from "@/components/reviewed-write"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ChoiceCard } from "@/components/ui/choice-card"
import { inputHints } from "@/components/ui/input"
import { RadioGroup } from "@/components/ui/radio-group"
import { fetchGoogleVerificationOptions } from "@/lib/api/google-verification-options"
import {
  verificationOptionsInputSchema,
  type VerificationOptionsInput,
  type VerificationOptionsResponse,
} from "@/lib/contracts/google-verification-options"
import type { VerificationReviewInput } from "@/lib/contracts/google-verification-review"
import {
  verificationChoiceDestination,
  verificationStartDraft,
} from "@/lib/locations/forms/verification"
import {
  VerificationMethodCode,
  verificationLanguageName,
  verificationMethodName,
} from "./verification-method"
import { cn } from "@/lib/utils"
import {
  VerificationContextFields,
  VerificationTextField,
  type VerificationAddressErrors,
} from "./verification-context-fields"

/** What Google last reported for the listing, as a hint for this form; null when not known. */
export type VerificationStanding = "verified" | "pending" | null

const standingCopy = {
  verified:
    "Google already confirms you manage this listing, so it would refuse a new verification request.",
  pending:
    "A verification request is already pending. Enter its PIN or check it before starting another.",
} as const

type InputProblems = VerificationAddressErrors & {
  readonly languageCode?: string
}

/** Which field stops the methods check, in words, from the schema's own issues. */
function inputProblems(
  issues: readonly {
    readonly path: readonly PropertyKey[]
    readonly code: string
  }[]
): InputProblems {
  const problems: { -readonly [Key in keyof InputProblems]: string } = {}
  for (const issue of issues) {
    const [root, , key, index] = issue.path
    if (root === "languageCode")
      problems.languageCode ??= "Enter a language tag such as en-GB."
    else if (key === "addressLines")
      problems.addressLines ??=
        index === undefined
          ? issue.code === "too_big"
            ? "Use five street address lines or fewer."
            : "Enter the first line of the address."
          : issue.code === "too_big"
            ? "Keep each street address line to 200 characters or fewer."
            : index === 0
              ? "Enter the first line of the address."
              : "Remove the empty street address line, or fill it in."
    else if (key === "regionCode")
      problems.regionCode ??= "Enter a two-letter country code, such as GB."
    else if (key === "languageCode")
      problems.addressLanguage ??=
        "Enter an address language tag such as en-GB, or leave it empty."
    else if (key === "recipients")
      problems.recipients ??= "Remove empty lines from the address recipients."
    else problems.address ??= "Check the private service-business address."
  }
  return problems
}

export function VerificationStartForm({
  locationId,
  blocked,
  busy,
  standing = null,
  onPreview,
}: {
  readonly locationId: string
  readonly blocked: boolean
  readonly busy: boolean
  readonly standing?: VerificationStanding
  readonly onPreview: (input: VerificationReviewInput) => void
}) {
  const [input, setInput] = useState<VerificationOptionsInput>({
    languageCode: "en-GB",
  })
  const [options, setOptions] = useState<VerificationOptionsResponse | null>(
    null
  )
  const [selected, setSelected] = useState("")
  const [emailUser, setEmailUser] = useState(""),
    [mailerContact, setMailerContact] = useState("")
  const [discovering, setDiscovering] = useState(false),
    [error, setError] = useState<string | null>(null)
  // Fields left at least once: their errors show from then on, not while typing the first time.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const touch = (key: string) =>
    setTouched((keys) => (keys.has(key) ? keys : new Set(keys).add(key)))
  const groupId = useId(),
    checkReasonId = useId(),
    reviewReasonId = useId(),
    contextReasonId = useId()
  const locked = busy || discovering
  const parsedInput = verificationOptionsInputSchema.safeParse(input)
  const problems: InputProblems = parsedInput.success
    ? {}
    : inputProblems(parsedInput.error.issues)
  const firstProblem =
    problems.addressLines ??
    problems.regionCode ??
    problems.addressLanguage ??
    problems.recipients ??
    problems.address ??
    problems.languageCode
  const shown = (key: keyof InputProblems) =>
    touched.has(key) ? problems[key] : undefined
  const choice = options?.options.find((item) => item.id === selected)
  const payload =
    choice && parsedInput.success
      ? verificationStartDraft(choice, parsedInput.data, {
          emailUser,
          mailerContact,
        })
      : null
  const languageName = verificationLanguageName(input.languageCode)
  const needsContext = options?.customerLocationOnly !== false && !input.context
  const emailEditable =
    choice?.kind === "email" && choice.userNameEditable === true
  const destinationProblem =
    choice?.kind === "email" && emailEditable && !payload
      ? emailUser.trim()
        ? "Enter a valid email username."
        : "Enter an email username."
      : choice?.kind === "address" && !payload
        ? "Enter who should receive the postcard."
        : undefined
  // Why Review is unavailable, said beside it; it stays disabled exactly when it was.
  const reviewReason = blocked
    ? "Review is unavailable while verification changes are paused."
    : locked
      ? null
      : !choice
        ? "Choose a verification destination first."
        : (destinationProblem ?? null)
  function update(next: VerificationOptionsInput) {
    setInput(next)
    setOptions(null)
    setSelected("")
    setEmailUser("")
    setMailerContact("")
    setError(null)
  }
  async function discover() {
    if (!parsedInput.success || locked) return
    setDiscovering(true)
    setError(null)
    setOptions(null)
    setSelected("")
    try {
      setOptions(
        await fetchGoogleVerificationOptions(locationId, parsedInput.data)
      )
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setError(
        "Verification methods could not be checked. Reconnect if needed, then try again. No verification request was sent."
      )
    } finally {
      setDiscovering(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-ui text-ink-muted">
        Check the methods Google currently offers, review the exact destination,
        then approve before sending a request.
      </p>
      <Checkbox
        label="Provide a private service-business address"
        checked={Boolean(input.context)}
        disabled={locked}
        onCheckedChange={(checked) =>
          update({
            ...input,
            context: checked
              ? { address: { regionCode: "GB", addressLines: [""] } }
              : undefined,
          })
        }
      />
      {input.context && (
        <VerificationContextFields
          value={input.context.address}
          disabled={locked}
          onChange={(address) => update({ ...input, context: { address } })}
          errors={{
            addressLines: shown("addressLines"),
            regionCode: shown("regionCode"),
            addressLanguage: shown("addressLanguage"),
            recipients: shown("recipients"),
          }}
          onFieldBlur={touch}
        />
      )}
      <VerificationTextField
        label="Verification language"
        value={input.languageCode}
        disabled={locked}
        onChange={(languageCode) => update({ ...input, languageCode })}
        onBlur={() => touch("languageCode")}
        error={shown("languageCode")}
        {...inputHints.identifier}
        hint={`${languageName ? `Google writes its message in ${languageName}. ` : ""}Change the language tag only if needed, for example en-GB or cy.`}
      />
      {standing && (
        <p role="status" className="text-ui text-ink-secondary">
          {standingCopy[standing]}
        </p>
      )}
      {firstProblem && (
        <p
          id={checkReasonId}
          role="status"
          className="text-caption text-ink-muted"
        >{`${firstProblem.replace(/\.$/, "")} before checking methods.`}</p>
      )}
      <Button
        variant="secondary"
        className="self-start"
        disabled={locked || !parsedInput.success}
        aria-describedby={firstProblem ? checkReasonId : undefined}
        onClick={() => void discover()}
        pending={discovering}
        pendingLabel="Checking methods…"
      >
        Check available methods
      </Button>
      {error && (
        <p role="alert" className="text-ui text-danger-ink">
          {error}
        </p>
      )}
      {options && (
        <>
          <p className="text-caption text-ink-muted">
            Methods checked <Instant value={options.checkedAt} />.
          </p>
          {needsContext && (
            <p
              id={contextReasonId}
              role="status"
              className="text-ui text-ink-secondary"
            >
              Google has not confirmed that a private service-business address
              is unnecessary. Provide the address and check methods again before
              reviewing a request.
            </p>
          )}
          {!options.options.length && (
            <p role="status" className="text-ui text-ink-muted">
              Google returned no methods for this check. Use Google Business
              Profile for further instructions or check again later.
            </p>
          )}
          <span id={groupId} className="text-ui font-semibold">
            Verification destination
          </span>
          <RadioGroup
            aria-labelledby={groupId}
            value={selected}
            disabled={locked}
            onValueChange={(id) => {
              const next = options.options.find((item) => item.id === id)
              setSelected(String(id))
              setEmailUser(next?.kind === "email" ? next.user : "")
              setMailerContact("")
            }}
            className="grid min-w-0 gap-3 sm:grid-cols-2"
          >
            {options.options.map((item) => (
              <ChoiceCard
                key={item.id}
                value={item.id}
                title={verificationMethodName(item.method)}
                description={
                  <span className="break-words">
                    {verificationChoiceDestination(item)}
                  </span>
                }
              >
                <VerificationMethodCode method={item.method} />
              </ChoiceCard>
            ))}
          </RadioGroup>
          {choice?.kind === "email" && (
            <VerificationTextField
              label="Email username"
              value={emailEditable ? emailUser : choice.user}
              readOnly={!emailEditable}
              disabled={locked}
              onChange={setEmailUser}
              onBlur={() => touch("emailUser")}
              error={touched.has("emailUser") ? destinationProblem : undefined}
              inputMode="email"
              {...inputHints.identifier}
              hint={`Google fixes the domain to @${choice.domain}.${choice.userNameEditable === true ? " You may change the username." : " Google has not allowed username edits."}`}
            />
          )}
          {choice?.kind === "phone" && (
            <VerificationTextField
              label="Eligible phone destination"
              value={choice.phoneNumber}
              readOnly
              hint="Use this exact Google-offered destination. Correct the business profile first if it is wrong."
            />
          )}
          {choice?.kind === "address" && (
            <>
              <VerificationTextField
                label="Postcard contact name"
                value={mailerContact}
                disabled={locked}
                maxLength={200}
                onChange={setMailerContact}
                onBlur={() => touch("mailerContact")}
                error={
                  touched.has("mailerContact") ? destinationProblem : undefined
                }
                autoCapitalize="words"
                hint="Who should receive Google's postcard at the displayed address?"
              />
              <p className="text-caption text-ink-muted">
                {choice.expectedDeliveryDays === null
                  ? "Google has not supplied a delivery estimate."
                  : `Google estimates ${choice.expectedDeliveryDays} days for delivery.`}
              </p>
            </>
          )}
          {choice?.kind === "external" ? (
            <p role="status" className="text-ui text-ink-secondary">
              This method must be completed through Google or an authorised
              verification partner. NabaPresence cannot send this request.
            </p>
          ) : (
            <>
              <Button
                className="self-start"
                disabled={blocked || locked || !payload || needsContext}
                aria-describedby={
                  needsContext && !blocked
                    ? contextReasonId
                    : reviewReason
                      ? reviewReasonId
                      : undefined
                }
                onClick={() => {
                  if (choice && payload && !needsContext)
                    onPreview({ optionId: choice.id, payload })
                }}
              >
                Review verification request
              </Button>
              {reviewReason && !(needsContext && !blocked) && (
                <p id={reviewReasonId} className="text-caption text-ink-muted">
                  {reviewReason}
                </p>
              )}
            </>
          )}
        </>
      )}
      <a
        href="https://business.google.com/"
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: "outline" }), "self-start")}
      >
        Open Google Business Profile
      </a>
    </div>
  )
}
