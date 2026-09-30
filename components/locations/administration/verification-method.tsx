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
