import "server-only"

import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

export type MemberRole = Session["role"]

export function assertRoleChangeAllowed(
  actorRole: MemberRole,
  targetRole: MemberRole
) {
  if (actorRole !== "owner" && targetRole === "owner") {
    throw new ApiError(
      403,
      "owner_role_required",
      "Only an owner can grant or change the owner role."
    )
  }
}
