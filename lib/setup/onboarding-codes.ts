import { LANGUAGE_OPTIONS } from "@/lib/settings/languages"

/**
 * The coded values the onboarding draft asks for, as pickable lists.
 *
 * Each list is the code the payload already stores (ISO 3166-1 alpha-2,
 * BCP-47, ISO 4217) with an English name from `Intl.DisplayNames`, so picking
 * "United Kingdom" stores exactly the "GB" an operator used to type. A saved
 * code outside a list is kept as an option of its own (`withCurrent`), never
 * dropped or rewritten.
 */
export type CodeOption = { readonly code: string; readonly label: string }

// ISO 3166-1 alpha-2, the assigned codes. Google's regionCode is CLDR's
// region, which is this set.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " "
  )

// Used only where the runtime cannot list its currencies.
const FALLBACK_CURRENCIES = ["GBP", "EUR", "USD"]

// Languages a listing in these markets is commonly written in, on top of the
// reply-language list: the UK's and Ireland's own languages first.
const EXTRA_LANGUAGES = [
  "cy",
  "ga",
  "gd",
  "pl",
  "ro",
  "pa",
  "ur",
  "bn",
  "zh",
  "tr",
]

function displayName(
  type: "region" | "language" | "currency",
  code: string
): string | undefined {
  try {
    const name = new Intl.DisplayNames(["en-GB"], { type }).of(code)
    return name && name !== code ? name : undefined
  } catch {
    return undefined
  }
}

const byLabel = (a: CodeOption, b: CodeOption) =>
  a.label.localeCompare(b.label, "en-GB")

let countries: readonly CodeOption[] | null = null
export function countryOptions(): readonly CodeOption[] {
  countries ??= COUNTRY_CODES.map((code) => ({
    code,
    label: displayName("region", code) ?? code,
  })).sort(byLabel)
  return countries
}

let languages: readonly CodeOption[] | null = null
export function languageOptions(): readonly CodeOption[] {
  languages ??= [
    ...LANGUAGE_OPTIONS,
    ...EXTRA_LANGUAGES.filter(
      (code) => !LANGUAGE_OPTIONS.some((option) => option.code === code)
    ).map((code) => ({ code, label: displayName("language", code) ?? code })),
  ]
  return languages
}

let currencies: readonly CodeOption[] | null = null
export function currencyOptions(): readonly CodeOption[] {
  if (currencies) return currencies
  const withValues = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[]
  }
  let codes = FALLBACK_CURRENCIES
  try {
    if (withValues.supportedValuesOf)
      codes = withValues.supportedValuesOf("currency")
  } catch {
    codes = FALLBACK_CURRENCIES
  }
  currencies = codes
    .map((code) => ({ code, label: displayName("currency", code) ?? code }))
    .sort(byLabel)
  return currencies
}

/** A plain name for any code, including one outside the lists. */
export function codeLabel(
  type: "region" | "language" | "currency",
  code: string
): string {
  return displayName(type, code) ?? code
}

/**
 * The list with the saved value kept as an option (first, so it is easy to
 * find), unless it is already in the list or blank.
 */
export function withCurrent(
  options: readonly CodeOption[],
  current: string,
  type: "region" | "language" | "currency"
): readonly CodeOption[] {
  if (!current || options.some((option) => option.code === current))
    return options
  const name = displayName(type, current)
  return [
    { code: current, label: name ? `${name} (saved)` : "Saved value" },
    ...options,
  ]
}

/**
 * A language tag typed by the operator that is not in the list, when it is a
 * well-formed BCP-47 tag. The tag is offered exactly as typed (trimmed):
 * the server validates it, as it did when this was a text field.
 */
export function typedLanguageTag(
  text: string,
  options: readonly CodeOption[]
): string | null {
  const tag = text.trim()
  if (!tag || tag.length > 35 || /\s/.test(tag)) return null
  if (options.some((option) => option.code.toLowerCase() === tag.toLowerCase()))
    return null
  try {
    Intl.getCanonicalLocales(tag)
    return tag
  } catch {
    return null
  }
}

/**
 * A typed two-letter country code outside the list (a user-assigned code
 * such as XK, which Google uses for Kosovo). The schemas accept any
 * `^[A-Z]{2}$` once uppercased, as the old text field did, so the list must
 * not be stricter than the server.
 */
export function typedCountryCode(
  text: string,
  options: readonly CodeOption[]
): string | null {
  const code = text.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return null
  return options.some((option) => option.code === code) ? null : code
}

/**
 * A typed three-letter currency code outside the list. The service price
 * schema accepts any `^[A-Z]{3}$`, and the payload builder uppercases what it
 * is given, so a code the runtime does not list stays enterable.
 */
export function typedCurrencyCode(
  text: string,
  options: readonly CodeOption[]
): string | null {
  const code = text.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return null
  return options.some((option) => option.code === code) ? null : code
}

/**
 * The code a typed text stands for, if any: an option whose code matches it
 * ignoring case (codes are case-insensitive: "gb" is GB, "en-gb" is en-GB),
 * else what `typed` accepts. This is what lets the picker still be typed
 * into like the text field it replaces: typing a full code commits it.
 */
export function codeForText(
  text: string,
  options: readonly CodeOption[],
  typed?: (text: string) => string | null
): string | null {
  const needle = text.trim().toLowerCase()
  if (!needle) return null
  const listed = options.find((option) => option.code.toLowerCase() === needle)
  if (listed) return listed.code
  return typed?.(text) ?? null
}
