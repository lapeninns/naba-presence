import type { AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"

type Row = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function scopeOf(name: string): string {
  return name.startsWith("accounts/")
    ? "the whole Google account"
    : "this listing"
}

/** Where an invitation would grant access, from Google's invitation row. */
function invitationPlace(row: Row | undefined): string | undefined {
  const location = row?.targetLocation,
    account = row?.targetAccount
  const fromLocation =
    location && typeof location === "object"
      ? text((location as Row).locationName)
      : undefined
  const fromAccount =
    account && typeof account === "object"
      ? text((account as Row).accountName)
      : undefined
  return fromLocation ?? fromAccount
}

/**
 * A person-readable description of the Google resource an access request
 * acts on, drawn from the reviewed request and Google's listed rows. The
 * exact resource name stays available as a secondary reference.
 */
export function accessTargetDescription(
  request: AdministrationAccessRequest,
  rows: readonly Row[]
): string {
  switch (request.operation) {
    case "create_admin": {
      const invitee =
        request.payload.admin ??
        request.payload.account ??
        "a new administrator"
      return `New invitation for ${invitee} on ${request.payload.scope === "account" ? "the whole Google account" : "this listing"}`
    }
    case "update_admin":
    case "delete_admin": {
      const admin = text(
        rows.find((row) => row.name === request.payload.name)?.admin
      )
      return admin
        ? `Administrator ${admin} on ${scopeOf(request.payload.name)}`
        : `An administrator on ${scopeOf(request.payload.name)}`
    }
    case "accept_invitation":
    case "decline_invitation": {
      const place = invitationPlace(
        rows.find((row) => row.name === request.payload.name)
      )
      return place
        ? `Invitation to manage ${place}`
        : "Pending invitation for the connected Google account"
    }
  }
}

/** The human target with the exact Google resource name as small secondary text. */
export function AccessTarget({
  request,
  target,
  rows,
}: {
  request: AdministrationAccessRequest
  target: string
  rows: readonly Row[]
}) {
  return (
    <>
      <span className="block">{accessTargetDescription(request, rows)}</span>
      <span className="mt-0.5 block text-caption break-all text-ink-muted">
        Google reference: {target}
      </span>
    </>
  )
}
