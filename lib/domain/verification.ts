import { detectLanguage } from "@/lib/domain/language"

export type VerificationReason = {
  code: string
  severity: "warn" | "fail"
  message: string
}

export function deterministicVerification(input: {
  body: string
  reviewText: string | null
  locationName: string
  otherLocationNames: string[]
  rating: number
  expectedLanguage?: string | null
}): VerificationReason[] {
  const reasons: VerificationReason[] = []
  const body = input.body.trim()
  const lower = body.toLowerCase()
  const reviewLower = input.reviewText?.toLowerCase() ?? ""
  const add = (code: string, severity: "warn" | "fail", message: string) =>
    reasons.push({ code, severity, message })

  if (!body) add("empty_reply", "fail", "The reply is empty.")
  if (Buffer.byteLength(body, "utf8") > 4096) {
    add(
      "reply_too_long",
      "fail",
      "The reply exceeds Google’s 4,096-byte limit."
    )
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(body) ||
    /(?:\+?\d[\d\s().-]{7,}\d)/u.test(body)
  ) {
    add(
      "personal_contact_data",
      "fail",
      "The reply contains an email address or phone number."
    )
  }
  if (/\b(free|discount|promo code|voucher|coupon)\b/iu.test(body)) {
    add(
      "forbidden_promotion",
      "fail",
      "The reply contains a promotion or incentive."
    )
  }
  if (
    /\b(refund(?:ed)?|reimburse(?:d)?|compensat(?:e|ed|ion)|guarantee(?:d)?)\b/iu.test(
      body
    ) &&
    !/\b(refund|reimburse|compensat|guarantee)\b/iu.test(reviewLower)
  ) {
    add(
      "unsupported_commitment",
      "fail",
      "The reply introduces a refund, compensation, or guarantee not in evidence."
    )
  }
  if (/\b(fuck|shit|bitch|bastard)\b/iu.test(body)) {
    add("unsafe_language", "fail", "The reply contains unsafe language.")
  }
  const wrongLocation = input.otherLocationNames.find(
    (name) =>
      name !== input.locationName &&
      name.length > 3 &&
      lower.includes(name.toLowerCase())
  )
  if (wrongLocation) {
    add(
      "wrong_location",
      "fail",
      `The reply mentions a different location: ${wrongLocation}.`
    )
  }
  if (input.rating <= 2 && !/\b(sorry|apolog|regret)\b/iu.test(body)) {
    add(
      "complaint_not_acknowledged",
      "warn",
      "The low-rating review is not explicitly acknowledged."
    )
  }
  if (body.length > 800) {
    add(
      "tone_length",
      "warn",
      "The reply may be too long for the selected tone."
    )
  }
  const expectedLanguage = input.expectedLanguage
  const nonLatinLanguage =
    expectedLanguage === "ar" ||
    expectedLanguage === "ru" ||
    expectedLanguage === "ja" ||
    expectedLanguage === "hi"
  const detectedLanguage =
    expectedLanguage && expectedLanguage !== "en" && !nonLatinLanguage
      ? detectLanguage(body)
      : null
  if (
    (nonLatinLanguage &&
      /^[\p{ASCII}\s\p{Punctuation}]+$/u.test(body)) ||
    (detectedLanguage &&
      (detectedLanguage.confidence ?? 0) >= 0.7 &&
      detectedLanguage.code !== expectedLanguage)
  ) {
    add(
      "language_mismatch",
      "warn",
      "The reply may not match the expected review language."
    )
  }
  return reasons
}

export function verificationVerdict(
  reasons: VerificationReason[]
): "pass" | "warn" | "fail" {
  return reasons.some((reason) => reason.severity === "fail")
    ? "fail"
    : reasons.length
      ? "warn"
      : "pass"
}
