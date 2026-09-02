/**
 * The booking tab's view of `/api/locations/[id]/place-actions/**`.
 *
 * The wire contract itself lives in `./location-place-actions` (owned by the
 * place-actions routes); this module only exposes it under the names the
 * booking client and tab use so nothing is declared twice. Client-safe.
 */
import { GOOGLE_PLACE_ACTION_TYPES, type GooglePlaceActionType } from "@/lib/domain/google-contract"

export {
  placeActionCreateRequestSchema,
  placeActionDeleteRequestSchema,
  placeActionInputSchema,
  placeActionLinkSchema,
  placeActionMutationOutcomeSchema,
  placeActionMutationSummarySchema,
  placeActionsResponseSchema,
  placeActionsStateSchema,
  placeActionUpdateRequestSchema,
  type PlaceActionCreateRequest,
  type PlaceActionDeleteRequest,
  type PlaceActionInput,
  type PlaceActionLink,
  type PlaceActionMutationOutcome,
  type PlaceActionMutationSummary,
  type PlaceActionsResponse,
  type PlaceActionsState,
  type PlaceActionUpdateRequest,
} from "./location-place-actions"

export const PLACE_ACTION_TYPES = GOOGLE_PLACE_ACTION_TYPES
export type PlaceActionType = GooglePlaceActionType

/** What the booking tab supplies to create/update a link (confirmations are added by the client). */
export type PlaceActionFields = {
  uri: string
  placeActionType: PlaceActionType
  isPreferred: boolean
}
