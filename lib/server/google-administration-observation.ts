import "server-only"
import { z } from "zod"
import type { AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"
import { googleAccountNameSchema } from "@/lib/contracts/google-administration-review"
import { administrationAccessObservationSchema } from "@/lib/contracts/google-administration-attempt"
import { administrationBaselineSchema, currentAdministrationContext, observeAdministrationAccess } from "@/lib/server/google-administration-state"
import { googleAccountManagementApi } from "@/lib/server/google"

export async function observeAdministrationPostcondition(
  session: Parameters<typeof currentAdministrationContext>[0], locationId: string,
  request: AdministrationAccessRequest, baseline: ReturnType<typeof administrationBaselineSchema.parse>
) {
  const linked = await currentAdministrationContext(session, locationId)
  const current = await observeAdministrationAccess(linked, request)
  let acceptedAccount: { name: string; role: string | null } | null = null
  if (request.operation === "accept_invitation" && !current.baseline.rows.some((row) => row.name === request.payload.name)) {
    const invitation = baseline.rows.find((row) => row.name === request.payload.name)
    const target = z.object({ name: googleAccountNameSchema }).safeParse(invitation?.targetAccount)
    if (target.success) {
      const account = await googleAccountManagementApi(await linked.accessToken(), { path: target.data.name }, { connectionKey: linked.connectionId })
      const parsed = z.object({ name: googleAccountNameSchema, role: z.string().optional() }).safeParse(account)
      if (parsed.success && parsed.data.name === target.data.name) acceptedAccount = { name: parsed.data.name, role: parsed.data.role ?? null }
    }
  }
  return administrationAccessObservationSchema.parse({ observedAt: current.observedAt, baseline: current.baseline, acceptedAccount })
}
