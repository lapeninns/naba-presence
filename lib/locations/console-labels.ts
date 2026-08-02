// One humanisation layer for the console editors (spec §7). No raw Google enum,
// gcid, valueType, or status code is ever shown to a user.

function titleCaseTail(raw: string): string {
  const tail = raw.split(":").pop() ?? raw
  const words = tail.replace(/^categories\//, "").split(/[_\s]+/).filter(Boolean)
  if (words.length === 0) return "Category"
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ")
}

export function categoryLabel(category: { name?: string; displayName?: string | null }): string {
  if (category.displayName) return category.displayName
  return titleCaseTail(category.name ?? "")
}

const ADMIN_ROLES: Record<string, string> = {
  PRIMARY_OWNER: "Primary owner",
  OWNER: "Owner",
  MANAGER: "Manager",
  SITE_MANAGER: "Site manager",
  COMMUNITY_MANAGER: "Community manager",
}
export function adminRoleLabel(role: string): string {
  return ADMIN_ROLES[role] ?? titleCaseTail(role)
}

export function attributeControlKind(
  valueType: string | undefined
): "bool" | "enum" | "repeated_enum" | "url" | "unsupported" {
  switch (valueType) {
    case "BOOL": return "bool"
    case "ENUM": return "enum"
    case "REPEATED_ENUM": return "repeated_enum"
    case "URL": return "url"
    default: return "unsupported"
  }
}

const OPEN_STATUS: Record<string, string> = {
  OPEN: "Open",
  CLOSED_PERMANENTLY: "Permanently closed",
  CLOSED_TEMPORARILY: "Temporarily closed",
}
export function openStatusLabel(status: string): string {
  return OPEN_STATUS[status] ?? titleCaseTail(status)
}

const SERVICE_AREA: Record<string, string> = {
  CUSTOMER_LOCATION_ONLY: "At the customer's location only",
  CUSTOMER_AND_BUSINESS_LOCATION: "At the business and the customer's location",
}
export function serviceAreaLabel(businessType: string): string {
  return SERVICE_AREA[businessType] ?? titleCaseTail(businessType)
}

const RELATION: Record<string, string> = {
  DEPARTMENT_OF: "Department of",
  INDEPENDENT_ESTABLISHMENT_IN: "Independent establishment in",
}
export function relationTypeLabel(relation: string): string {
  return RELATION[relation] ?? titleCaseTail(relation)
}

export function callsStateLabel(state: string): string {
  if (state === "ENABLED") return "On"
  if (state === "DISABLED") return "Off"
  return titleCaseTail(state)
}

const VERIFICATION_METHOD: Record<string, string> = {
  EMAIL: "Email",
  PHONE_CALL: "Phone call",
  SMS: "Text message",
  ADDRESS: "Postcard by mail",
  VETTED_PARTNER: "Vetted partner",
  AUTO: "Automatic",
}
export function verificationMethodLabel(method: string): string {
  return VERIFICATION_METHOD[method] ?? titleCaseTail(method)
}

const VERIFICATION_STATE: Record<string, string> = {
  PENDING: "Pending",
  COMPLETED: "Completed",
  FAILED: "Failed",
}
export function verificationStateLabel(state: string): string {
  return VERIFICATION_STATE[state] ?? titleCaseTail(state)
}
