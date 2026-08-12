import "server-only"

import { z } from "zod"

import { googleAccounts, googleLocations } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"

const accountSchema = z
  .object({
    name: z.string().min(1),
    accountName: z.string().optional(),
    type: z.string().optional(),
    role: z.string().optional(),
    permissionLevel: z.string().optional(),
  })
  .catchall(z.json())

const locationSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    storefrontAddress: z.record(z.string(), z.json()).optional(),
    metadata: z
      .object({
        hasVoiceOfMerchant: z.boolean().optional(),
      })
      .catchall(z.json())
      .optional(),
  })
  .catchall(z.json())

export type AutomaticGoogleCandidate =
  | {
      readonly kind: "candidate"
      readonly account: z.infer<typeof accountSchema>
      readonly location: z.infer<typeof locationSchema>
    }
  | { readonly kind: "manual_accounts"; readonly accountCount: number }
  | {
      readonly kind: "manual_locations"
      readonly accountName: string
      readonly locationCount: number
    }

export async function discoverAutomaticGoogleCandidate(input: {
  readonly accessToken: string
  readonly connectionId: string
}): Promise<AutomaticGoogleCandidate> {
  const accounts: z.infer<typeof accountSchema>[] = []
  const seenAccountTokens = new Set<string>()
  let accountPageToken: string | undefined
  do {
    const response = await googleAccounts(input.accessToken, accountPageToken, {
      connectionKey: input.connectionId,
    })
    accounts.push(...z.array(accountSchema).parse(response.accounts ?? []))
    accountPageToken = response.nextPageToken
    if (accountPageToken) {
      if (seenAccountTokens.has(accountPageToken)) {
        throw new ApiError(
          502,
          "google_pagination_cycle",
          "Google returned a repeated account page token."
        )
      }
      seenAccountTokens.add(accountPageToken)
    }
  } while (accountPageToken)

  if (accounts.length !== 1) {
    return { kind: "manual_accounts", accountCount: accounts.length }
  }

  const account = accounts[0]
  const locations: z.infer<typeof locationSchema>[] = []
  const seenLocationTokens = new Set<string>()
  let locationPageToken: string | undefined
  do {
    const response = await googleLocations(
      input.accessToken,
      account.name,
      locationPageToken,
      { connectionKey: input.connectionId }
    )
    locations.push(...z.array(locationSchema).parse(response.locations ?? []))
    locationPageToken = response.nextPageToken
    if (locationPageToken) {
      if (seenLocationTokens.has(locationPageToken)) {
        throw new ApiError(
          502,
          "google_pagination_cycle",
          "Google returned a repeated location page token."
        )
      }
      seenLocationTokens.add(locationPageToken)
    }
  } while (locationPageToken)

  if (locations.length !== 1) {
    return {
      kind: "manual_locations",
      accountName: account.name,
      locationCount: locations.length,
    }
  }

  return { kind: "candidate", account, location: locations[0] }
}
