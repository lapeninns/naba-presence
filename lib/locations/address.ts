/**
 * One line of a stored Google address, for a row or a header.
 *
 * The directory keeps the raw `address_json` Google returned; the parts a
 * person reads are the lines, the locality, the area and the postcode, in
 * that order. Pure and client-safe.
 */
export function formatAddressLine(address: unknown): string | null {
  if (!address || typeof address !== "object") return null
  const record = address as Record<string, unknown>
  const lines = Array.isArray(record.addressLines)
    ? (record.addressLines as unknown[]).filter(
        (line): line is string => typeof line === "string"
      )
    : []
  const parts = [
    ...lines,
    record.locality,
    record.administrativeArea,
    record.postalCode,
  ].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  )
  return parts.length ? parts.join(", ") : null
}
