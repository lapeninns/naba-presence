import { beforeEach, describe, expect, it, vi } from "vitest"
import { verificationCompletionInputSchema } from "@/lib/contracts/google-verification-completion-review"

const env = { TOKEN_ENCRYPTION_KEY: "binding-test-original-key-32-characters!", TOKEN_ENCRYPTION_KEYS: [] }
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))
const { assertVerificationPinBinding, bindVerificationPin } = await import("@/lib/server/google-verification-pin-binding")
const { decryptSecret, reencryptSecret } = await import("@/lib/server/crypto")
const input = verificationCompletionInputSchema.parse({ name: "locations/business/verifications/pending", pin: " 001234 " })
beforeEach(() => { env.TOKEN_ENCRYPTION_KEY = "binding-test-original-key-32-characters!" })

describe("private reviewed PIN binding", () => {
  it("recognises the normalized leading-zero PIN without storing it", () => {
    const binding = bindVerificationPin(input)
    expect(() => assertVerificationPinBinding(binding.privatePayload, binding.credentialBindingHash, input)).not.toThrow()
    const stored = JSON.parse(decryptSecret(binding.privatePayload))
    expect(Object.keys(stored).sort()).toEqual(["commitment", "key"])
    expect(JSON.stringify(stored)).not.toContain(input.pin)
  })
  it.each([
    { ...input, pin: "1234" },
    { ...input, pin: "001235" },
    { ...input, name: "locations/business/verifications/other" },
    { ...input, name: "locations/foreign/verifications/pending" },
  ])("refuses changed credential or target", (changed) => {
    const binding = bindVerificationPin(input)
    expect(() => assertVerificationPinBinding(binding.privatePayload, binding.credentialBindingHash, changed)).toThrow(expect.objectContaining({ code: "verification_pin_changed" }))
  })
  it("creates unrelated bindings for repeated identical PINs", () => {
    const first = bindVerificationPin(input), second = bindVerificationPin(input)
    expect(first.credentialBindingHash).not.toBe(second.credentialBindingHash)
    expect(() => assertVerificationPinBinding(second.privatePayload, first.credentialBindingHash, input)).toThrow(expect.objectContaining({ code: "approval_stale" }))
  })
  it("requires a fresh review if immutable private bytes are rotated or corrupted", () => {
    const binding = bindVerificationPin(input)
    const rotated = reencryptSecret(binding.privatePayload)
    expect(() => assertVerificationPinBinding(rotated, binding.credentialBindingHash, input)).toThrow(expect.objectContaining({ code: "approval_stale" }))
    const broken = Buffer.from(binding.privatePayload); broken[15] = (broken[15] ?? 0) ^ 1
    expect(() => assertVerificationPinBinding(broken, binding.credentialBindingHash, input)).toThrow(expect.objectContaining({ code: "approval_stale" }))
  })
  it("returns a safe error when the encryption key is no longer accepted", () => {
    const binding = bindVerificationPin(input)
    env.TOKEN_ENCRYPTION_KEY = "binding-test-new-key-with-32-characters!"
    expect(() => assertVerificationPinBinding(binding.privatePayload, binding.credentialBindingHash, input)).toThrow(expect.objectContaining({ code: "approval_stale" }))
  })
})
