import { formatInstant } from "@/components/editors/change-diff"
import { ResourceRef, TechnicalDetails } from "@/components/reviewed-write"
import { verificationMethodLabel } from "@/lib/locations/console-labels"

const KNOWN_METHODS = new Set([
  "EMAIL",
  "PHONE_CALL",
  "SMS",
  "ADDRESS",
  "VETTED_PARTNER",
  "AUTO",
])
const UNKNOWN_METHOD_LABEL = "Another Google method"

/** A verification method in words; a method NabaPresence does not know is never shown as its raw code. */
export function verificationMethodName(
  method: string | null | undefined
): string {
  return method && KNOWN_METHODS.has(method)
    ? verificationMethodLabel(method)
    : UNKNOWN_METHOD_LABEL
}

/** Google's raw code for an unrecognised method, as secondary detail only; null for known or absent methods. */
export function unrecognisedMethodCode(
  method: string | null | undefined
): string | null {
  return method && method !== "UNKNOWN" && !KNOWN_METHODS.has(method)
    ? method
    : null
}

export function VerificationMethodCode({
  method,
}: {
  readonly method: string | null | undefined
}) {
  const code = unrecognisedMethodCode(method)
  return code ? (
    <span className="block font-mono text-caption break-all text-ink-muted">
      Google method code: {code}
    </span>
  ) : null
}

/** A verification request in words: its method and when Google says it was requested. */
export function verificationRequestDescription(
  method: string | null | undefined,
  createTime: string | null | undefined
): string {
  const when = createTime
    ? `requested ${formatInstant(createTime)}`
    : "request time not reported by Google"
  return `${verificationMethodName(method)} verification, ${when}`
}

/**
 * Google's exact resource name for a request, as secondary detail only: one
 * tap away under "Technical details", never in the human summary.
 */
export function VerificationRequestReference({
  name,
}: {
  readonly name: string
}) {
  return (
    <TechnicalDetails>
      <ResourceRef label="Google reference" value={name} />
    </TechnicalDetails>
  )
}

function displayName(type: "language" | "region", code: string | null | undefined): string | null {
  if (!code) return null
  try {
    const name = new Intl.DisplayNames(["en-GB"], { type }).of(code)
    return name && name !== code ? name : null
  } catch {
    return null
  }
}

/** A BCP-47 language tag in words ("British English"); null when it cannot be named. */
export function verificationLanguageName(tag: string | null | undefined): string | null {
  return displayName("language", tag?.trim())
}

/** A two-letter region code in words ("United Kingdom"); null when it cannot be named. */
export function verificationRegionName(code: string | null | undefined): string | null {
  return code && /^[A-Za-z]{2}$/.test(code) ? displayName("region", code.toUpperCase()) : null
}
