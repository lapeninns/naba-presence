import { describe, expect, it } from "vitest"

import { detectLanguage } from "@/lib/domain/language"

describe("detectLanguage", () => {
  const latinCases = [
    {
      code: "de",
      text: "Das Frühstück war hervorragend und das Personal sehr freundlich.",
    },
    {
      code: "es",
      text: "El desayuno estaba delicioso y el personal fue muy amable.",
    },
    {
      code: "fr",
      text: "Le petit déjeuner était excellent et le personnel très aimable.",
    },
    {
      code: "it",
      text: "La colazione era ottima e il personale gentilissimo.",
    },
  ] as const

  for (const { code, text } of latinCases) {
    it(`detects ${code} without falling back to English`, () => {
      const result = detectLanguage(text)
      expect(result.code).not.toBe("en")
      expect(result.code).toBe(code)
      expect(result.confidence).not.toBeNull()
    })
  }

  it.each([
    [
      "en",
      "The breakfast was excellent and the staff were lovely.",
    ],
    [
      "hi",
      "नाश्ता बहुत अच्छा था और कर्मचारी बहुत विनम्र थे।",
    ],
    ["ru", "Отличный завтрак и очень вежливый персонал."],
    ["ja", "朝食は素晴らしく、スタッフはとても親切でした。"],
  ])("detects %s", (code, text) => {
    expect(detectLanguage(text).code).toBe(code)
  })

  it("returns no language for a rating-only review", () => {
    expect(detectLanguage(null)).toEqual({
      code: null,
      confidence: null,
    })
  })

  it("does not guess from short Latin text", () => {
    expect(detectLanguage("ok")).toEqual({
      code: null,
      confidence: null,
    })
  })
})
