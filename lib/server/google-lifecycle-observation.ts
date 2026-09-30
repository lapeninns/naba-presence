import "server-only"
import { z } from "zod"
import { googleAccountNameSchema, googleAdminRoleSchema } from "@/lib/contracts/google-administration-review"
import { googleLifecycleBaselineSchema, googleLifecycleObservationSchema, lifecycleLocationNameSchema, type GoogleLifecycleBaseline, type GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"
import { currentAdministrationContext } from "@/lib/server/google-administration-state"
import type { reviewedLifecyclePayloadSchema } from "@/lib/contracts/google-lifecycle-review"
import { getGoogleLocation, googleAccountManagementApi, googleLocations } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const wireLocation = z.looseObject({ name: lifecycleLocationNameSchema, metadata: z.looseObject({ placeId: z.string().optional(), canDelete: z.boolean().optional() }).optional() })
const wirePage = z.looseObject({ locations: z.array(wireLocation).default([]), nextPageToken: z.string().optional() })
const wireAccount = z.looseObject({ name: googleAccountNameSchema, role: z.string().optional() })
type Linked = Awaited<ReturnType<typeof currentAdministrationContext>>

function projectLocation(location: z.infer<typeof wireLocation>) {
  return { name: location.name, placeId: location.metadata?.placeId || null, canDelete: location.metadata?.canDelete ?? null }
}

async function inventory(linked: Linked, accountName: string, token: string): Promise<GoogleLifecycleBaseline["source"]> {
  const options = { connectionKey: linked.connectionId }
  const account = wireAccount.safeParse(await googleAccountManagementApi(token, { path: accountName }, options))
  if (!account.success || account.data.name !== accountName) throw new ApiError(502, "lifecycle_account_unreadable", "Google did not confirm the exact account identity.")
  const role = googleAdminRoleSchema.safeParse(account.data.role)
  const locations: GoogleLifecycleBaseline["source"]["locations"] = []
  const names = new Set<string>(), tokens = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 100; page++) {
    const response = wirePage.safeParse(await googleLocations(token, accountName, pageToken, options))
    if (!response.success) throw new ApiError(502, "lifecycle_inventory_unreadable", "Google returned incomplete location identities. Refresh the account inventory.")
    for (const location of response.data.locations) {
      if (names.has(location.name)) throw new ApiError(502, "lifecycle_inventory_unreadable", "Google repeated a location during account discovery. Refresh before continuing.")
      names.add(location.name); locations.push(projectLocation(location))
    }
    pageToken = response.data.nextPageToken || undefined
    if (!pageToken) return { account: { name: accountName, role: role.success ? role.data : null }, complete: true, locations: locations.sort((a, b) => a.name.localeCompare(b.name)) }
    if (tokens.has(pageToken)) break
    tokens.add(pageToken)
  }
  throw new ApiError(502, "lifecycle_inventory_incomplete", "Google account discovery did not finish. Retry before reviewing or confirming the lifecycle change.")
}

async function locationRead(linked: Linked, token: string) {
  const result = wireLocation.safeParse(await getGoogleLocation(token, linked.googleLocationName, ["name", "metadata"], { connectionKey: linked.connectionId }))
  if (!result.success || result.data.name !== linked.googleLocationName) throw new ApiError(502, "lifecycle_location_unreadable", "Google did not confirm the exact location identity.")
  return projectLocation(result.data)
}

export async function observeLifecycleBaseline(session: Session, locationId: string, request: GoogleLifecycleRequest) {
  const linked = await currentAdministrationContext(session, locationId)
  const token = await linked.accessToken()
  const [source, destination, location] = await Promise.all([
    inventory(linked, linked.accountName, token),
    request.operation === "transfer_location" ? inventory(linked, request.payload.destinationAccount, token) : Promise.resolve(null),
    locationRead(linked, token),
  ])
  return { linked, baseline: googleLifecycleBaselineSchema.parse({ observedAt: new Date().toISOString(), source, destination, location }) }
}

export async function observeLifecyclePostcondition(session: Session, locationId: string, payload: z.infer<typeof reviewedLifecyclePayloadSchema>, baseline: GoogleLifecycleBaseline) {
  const request = payload.request
  const linked = await currentAdministrationContext(session, locationId)
  const allowedAccounts = request.operation === "transfer_location" ? [baseline.source.account.name, request.payload.destinationAccount] : [baseline.source.account.name]
  if (!allowedAccounts.includes(linked.accountName) || linked.googleLocationName !== baseline.location.name || linked.connectionId !== payload.connectionId || linked.credentialGeneration !== payload.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google lifecycle target changed. Restore the original outcome before another write.")
  const token = await linked.accessToken()
  const [source, destination, location] = await Promise.all([
    inventory(linked, baseline.source.account.name, token),
    request.operation === "transfer_location" ? inventory(linked, request.payload.destinationAccount, token) : Promise.resolve(null),
    locationRead(linked, token).then((value) => ({ state: "accessible", location: value })).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return { state: "not_found" }
      if (error instanceof ApiError && error.status === 403) return { state: "forbidden" }
      return { state: "unavailable" }
    }),
  ])
  return googleLifecycleObservationSchema.parse({ observedAt: new Date().toISOString(), source, destination, locationRead: location })
}
