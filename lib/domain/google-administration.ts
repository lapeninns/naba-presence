import type { AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"

export function administrationAccessTarget(request: AdministrationAccessRequest, linked: {
  readonly accountName: string
  readonly googleLocationName: string
}) {
  switch (request.operation) {
    case "create_admin": {
      const parent = request.payload.scope === "account" ? linked.accountName : linked.googleLocationName
      return { parent, collection: `${parent}/admins`, target: `${parent}/admins`, resourceType: request.payload.scope === "account" ? "account_admin" : "location_admin" }
    }
    case "update_admin":
    case "delete_admin": {
      const parent = request.payload.name.startsWith("accounts/") ? linked.accountName : linked.googleLocationName
      if (!request.payload.name.startsWith(`${parent}/admins/`)) throw new RangeError("The administrator is outside this listing's linked Google target.")
      return { parent, collection: `${parent}/admins`, target: request.payload.name, resourceType: request.payload.name.startsWith("accounts/") ? "account_admin" : "location_admin" }
    }
    case "accept_invitation":
    case "decline_invitation": {
      if (!request.payload.name.startsWith(`${linked.accountName}/invitations/`)) throw new RangeError("The invitation is outside this listing's linked Google account.")
      return { parent: linked.accountName, collection: `${linked.accountName}/invitations`, target: request.payload.name, resourceType: "invitation" }
    }
  }
}
