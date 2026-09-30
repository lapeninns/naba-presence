export const GOOGLE_SUPPORT_VERSION = "2026-09-29.1"
export const GOOGLE_SUPPORT_CHECKED_AT = "2026-09-29"
export const GOOGLE_DEPRECATION_SOURCE =
  "https://developers.google.com/my-business/content/sunset-dates"

export const RETIRED_GOOGLE_CAPABILITIES = {
  businessCalls: {
    label: "Business Calls",
    discontinuedAt: "2023-05-30",
    methods: ["locations.getBusinesscallssettings", "locations.updateBusinesscallssettings", "locations.businesscallsinsights.list"],
  },
  healthcareProviderAttributes: {
    label: "Healthcare provider attributes",
    discontinuedAt: "2024-07-01",
    methods: ["accounts.locations.getHealthProviderAttributes", "accounts.locations.updateHealthProviderAttributes"],
  },
  insuranceNetworks: {
    label: "Insurance networks",
    discontinuedAt: "2024-07-01",
    methods: ["accounts.locations.insuranceNetworks.list"],
  },
  questionsAndAnswers: {
    label: "Questions and answers",
    discontinuedAt: "2025-11-03",
    methods: ["locations.questions.list", "locations.questions.create", "locations.questions.patch", "locations.questions.delete", "locations.questions.answers.list", "locations.questions.answers.upsert", "locations.questions.answers.delete"],
  },
  locationAssociation: {
    label: "Legacy location association",
    discontinuedAt: "2023-05-30",
    methods: ["locations.associate", "locations.clearLocationAssociation"],
  },
  legacyLocationInsights: {
    label: "Legacy location insights",
    discontinuedAt: "2023-03-30",
    methods: ["accounts.locations.reportInsights"],
  },
  legacyPostInsights: {
    label: "Legacy post insights",
    discontinuedAt: "2023-02-20",
    methods: ["accounts.locations.localPosts.reportInsights"],
  },
} as const

export type RetiredGoogleCapability = keyof typeof RETIRED_GOOGLE_CAPABILITIES

const retiredStoredResources: Readonly<Record<string, RetiredGoogleCapability>> = {
  business_calls: "businessCalls",
  business_call_insights: "businessCalls",
  healthcare_provider_attributes: "healthcareProviderAttributes",
  insurance_networks: "insuranceNetworks",
  questions: "questionsAndAnswers",
  answers: "questionsAndAnswers",
}

export function retiredStoredGoogleResource(resourceType: string): RetiredGoogleCapability | undefined {
  return retiredStoredResources[resourceType]
}

export function retiredGoogleCapability(url: string): RetiredGoogleCapability | null {
  const target = new URL(url)
  if (target.hostname === "mybusinessbusinesscalls.googleapis.com") return "businessCalls"
  if (target.hostname === "mybusinessqanda.googleapis.com") return "questionsAndAnswers"
  if (target.hostname === "mybusiness.googleapis.com") {
    if (/\/locations:reportInsights$/.test(target.pathname)) return "legacyLocationInsights"
    if (/\/localPosts:reportInsights$/.test(target.pathname)) return "legacyPostInsights"
    if (/\/healthProviderAttributes\/?$/.test(target.pathname)) return "healthcareProviderAttributes"
    if (/\/insuranceNetworks(?:\/|$)/.test(target.pathname)) return "insuranceNetworks"
    if (/\/questions(?:\/|$)/.test(target.pathname)) return "questionsAndAnswers"
  }
  if (
    target.hostname === "mybusinessbusinessinformation.googleapis.com" &&
    /:(?:associate|clearLocationAssociation)$/.test(target.pathname)
  ) return "locationAssociation"
  return null
}

export function retiredGoogleMessage(capability: RetiredGoogleCapability): string {
  return `${RETIRED_GOOGLE_CAPABILITIES[capability].label} is retired by Google. Historical records are read-only.`
}
