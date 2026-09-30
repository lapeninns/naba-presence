import type { AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"
import type { AdministrationAccessAttempt, AdministrationAccessObservation } from "@/lib/contracts/google-administration-attempt"

type Baseline = AdministrationAccessObservation["baseline"]
type Confirmation = { readonly confirmed: boolean; readonly postcondition: AdministrationAccessAttempt["postcondition"]; readonly pendingInvitation: boolean | null }
const unknown: Confirmation = { confirmed: false, postcondition: "unknown", pendingInvitation: null }

export function administrationAccessConfirmation(input: {
  readonly request: AdministrationAccessRequest
  readonly baseline: Baseline
  readonly observation: AdministrationAccessObservation
  readonly receipt: { readonly name: string; readonly admin?: string; readonly account?: string } | null
}): Confirmation {
  const { request, baseline, observation, receipt } = input
  if (baseline.collection !== observation.baseline.collection) return unknown
  switch (request.operation) {
    case "create_admin": {
      const invitee = request.payload
      const beforeNames = new Set(baseline.rows.map((row) => row.name))
      const matches = observation.baseline.rows.filter((row) => {
        if (beforeNames.has(row.name) || row.role !== invitee.role) return false
        if (receipt && row.name !== receipt.name) return false
        const identity = invitee.account ? row.account === invitee.account
          : typeof row.admin === "string" && row.admin.toLowerCase() === invitee.admin?.toLowerCase()
        const receiptIdentity = !invitee.account && receipt && row.pendingInvitation !== true
          && !(typeof row.admin === "string" && row.admin.includes("@"))
          && receipt.admin?.toLowerCase() === invitee.admin?.toLowerCase()
        return Boolean(identity || receiptIdentity)
      })
      const row = matches.length === 1 ? matches[0] : null
      return row ? { confirmed: true, postcondition: "administrator_present", pendingInvitation: typeof row.pendingInvitation === "boolean" ? row.pendingInvitation : false } : unknown
    }
    case "update_admin": {
      const payload = request.payload
      if (!baseline.rows.some((item) => item.name === payload.name)) return unknown
      const row = observation.baseline.rows.find((item) => item.name === payload.name && item.role === payload.role)
      return row ? { confirmed: true, postcondition: "administrator_role_changed", pendingInvitation: typeof row.pendingInvitation === "boolean" ? row.pendingInvitation : false } : unknown
    }
    case "delete_admin":
      if (!baseline.rows.some((row) => row.name === request.payload.name)) return unknown
      return observation.baseline.rows.some((row) => row.name === request.payload.name) ? unknown : { confirmed: true, postcondition: "administrator_absent", pendingInvitation: null }
    case "decline_invitation":
      if (!baseline.rows.some((row) => row.name === request.payload.name)) return unknown
      return observation.baseline.rows.some((row) => row.name === request.payload.name) ? unknown : { confirmed: true, postcondition: "invitation_absent", pendingInvitation: null }
    case "accept_invitation": {
      if (observation.baseline.rows.some((row) => row.name === request.payload.name)) return unknown
      const invitation = baseline.rows.find((row) => row.name === request.payload.name)
      const target = invitation?.targetAccount
      const accountName = target && typeof target === "object" && !Array.isArray(target) ? Reflect.get(target, "name") : null
      const access = observation.acceptedAccount
      if (typeof accountName !== "string" || !access || access.name !== accountName || access.role !== invitation?.role || !["PRIMARY_OWNER", "OWNER", "MANAGER", "SITE_MANAGER"].includes(access.role ?? "")) return unknown
      return { confirmed: true, postcondition: "account_access_present", pendingInvitation: null }
    }
  }
}
