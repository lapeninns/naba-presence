import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import {
  describeActionError,
  GENERIC_ERROR_COPY,
  isNotLinkedError,
  isPausedError,
  NETWORK_ERROR_COPY,
  SERVICE_UNAVAILABLE_COPY,
} from "@/lib/errors/action-errors"

const api = (status: number, code: string) => new ApiClientError(status, code, "raw server message")

/** Every code in the table maps to plain copy that never echoes the code. */
function expectMapped(cases: Array<[string, number, RegExp]>) {
  for (const [code, status, pattern] of cases) {
    const copy = describeActionError(api(status, code))
    expect(copy, code).toMatch(pattern)
    expect(copy, code).not.toContain(code)
  }
}

describe("describeActionError — merged map", () => {
  it("uses the mandated second-approver copy for replies by default", () => {
    expect(describeActionError(api(403, "second_approver_required"))).toBe(
      "A different authorised user must approve this reply."
    )
    expect(describeActionError(api(409, "approval_not_pending"))).toBe(
      "This review is no longer awaiting approval."
    )
  })

  it("switches the two approval codes to post wording with context: post", () => {
    expect(describeActionError(api(403, "second_approver_required"), { context: "post" })).toBe(
      "A different authorised user must approve this post."
    )
    expect(describeActionError(api(409, "approval_not_pending"), { context: "post" })).toBe(
      "This post is no longer awaiting approval."
    )
    // context only affects the approval pair
    expect(describeActionError(api(503, "publishing_paused"), { context: "post" })).toBe(
      describeActionError(api(503, "publishing_paused"))
    )
  })

  it("maps ambiguous provider outcomes without leaking the code", () => {
    const copy = describeActionError(api(502, "google_mutation_ambiguous"))
    expect(copy).toContain("Check its status")
    expect(copy).not.toContain("google_mutation_ambiguous")
  })

  // U1: the publish path's grep-confirmed code set (lib/server/publishing.ts)
  // must map to plain copy — never the raw code.
  it("maps every publish-path code to plain copy", () => {
    expectMapped([
      ["review_changed", 409, /re-verify/i],
      ["location_not_verified", 409, /not verified/i],
      ["verification_failed", 409, /could not confirm/i],
      ["verification_required", 409, /re-verifying/i],
      ["stale_draft_evidence", 409, /changed/i],
      ["publish_permission_required", 403, /permission/i],
      ["publishing_paused", 503, /paused/i],
      ["drafts_paused", 503, /paused/i],
    ])
  })

  it("maps the wave-1 location codes to plain copy", () => {
    expectMapped([
      ["profile_snapshot_stale", 409, /changed since you loaded/i],
      ["google_hours_overwrite_confirmation_required", 409, /google changed/i],
      ["media_stale", 409, /changed on google/i],
      ["place_action_not_editable", 409, /cannot be edited/i],
      ["food_menus_not_eligible", 409, /cannot have a food menu/i],
      ["second_approver_required", 403, /different/i],
      ["posts_paused", 503, /paused/i],
      ["media_file_too_large", 413, /75 ?mb/i],
    ])
  })

  it("maps the M8 console codes to plain copy", () => {
    expectMapped([
      ["business_information_paused", 503, /unavailable/i],
      ["business_information_stale", 409, /changed on google/i],
      ["attributes_stale", 409, /changed on google/i],
      ["business_information_readback_mismatch", 502, /did not confirm/i],
      ["google_writes_paused", 503, /unavailable/i],
      ["business_calls_mask_invalid", 422, /calls setting/i],
      ["publish_not_allowed", 403, /permission/i],
      ["permission_denied", 403, /permission/i],
    ])
  })

  it("maps the M6 settings codes to plain copy", () => {
    expectMapped([
      ["direct_publish_consent_required", 403, /owner must/i],
      ["last_owner", 409, /last owner/i],
      ["cannot_remove_self", 409, /your own/i],
      ["use_invitations", 410, /invitation/i],
      ["invitation_pending", 409, /already/i],
      ["invitation_not_found", 404, /no longer|not found/i],
      ["privacy_legal_hold", 409, /legal hold/i],
      ["privacy_subject_not_found", 404, /no records/i],
      ["legal_hold_not_found", 404, /no active/i],
      ["relink_confirmation_required", 409, /confirm/i],
      ["location_already_linked", 409, /already linked/i],
      ["accounts_not_discovered", 409, /discover/i],
      ["google_reconnect_required", 401, /reconnect/i],
      ["sync_paused", 503, /paused/i],
      ["backfill_batch_running", 409, /in progress|running|wait/i],
      ["active_google_account_not_found", 404, /active Google account/i],
    ])
  })

  it("maps the write-gate and pause codes to honest copy", () => {
    expectMapped([
      ["hours_publishing_disabled", 409, /opening hours.*unavailable/i],
      ["profile_publishing_disabled", 409, /profile.*unavailable/i],
      ["media_paused", 503, /photo and video.*paused/i],
      ["place_actions_paused", 503, /booking link.*paused/i],
      ["google_writes_paused", 503, /unavailable/i],
      ["business_information_paused", 503, /unavailable/i],
      ["sync_paused", 503, /syncing with google.*paused/i],
    ])
  })

  it("maps the AI provider codes (lib/server/ai.ts) to plain copy", () => {
    expectMapped([
      ["ai_not_configured", 503, /ai assistance.*not available|isn’t available/i],
      ["ai_timeout", 502, /too long/i],
      ["ai_provider_error", 502, /ai provider/i],
      ["ai_empty_response", 502, /returned nothing/i],
    ])
  })

  // Wave 2 made these reachable. Each one's status fallback is not merely
  // vaguer than the truth, it points the operator at the wrong action, so the
  // assertions below pin the correction rather than just "some copy exists".
  it("maps the in-progress 409s without telling the user to refresh", () => {
    for (const code of ["post_publish_in_progress", "gbp_mutation_in_progress"]) {
      const copy = describeActionError(api(409, code))
      expect(copy, code).toMatch(/wait a moment/i)
      expect(copy, code).not.toMatch(/refresh/i)
    }
  })

  it("says a failed post publish did not reach Google, not 'try later'", () => {
    const copy = describeActionError(api(502, "google_post_not_published"))
    expect(copy).not.toBe(SERVICE_UNAVAILABLE_COPY)
    expect(copy).toMatch(/nothing was published/i)
  })

  it("maps the reply publish/delete settlement codes to their real cause", () => {
    expectMapped([
      ["previous_publish_failed", 409, /edit the reply/i],
      ["previous_delete_failed", 409, /refused to remove/i],
      ["reply_diverged", 409, /not the one we sent/i],
      ["google_delete_failed", 502, /refused to remove/i],
    ])
  })

  it("does not blame the caller for an attempt parked on its own back-off", () => {
    for (const code of ["publish_retry_not_ready", "delete_retry_not_ready"]) {
      const copy = describeActionError(api(429, code))
      expect(copy, code).toMatch(/retried automatically/i)
      expect(copy, code).not.toMatch(/too many requests/i)
    }
  })

  it("maps the 400s, which have no status fallback at all", () => {
    for (const [code, pattern] of [
      ["media_file_required", /choose a photo or video/i],
      ["profile_fields_required", /at least one profile field/i],
      ["profile_confirmation_invalid", /couldn’t confirm/i],
    ] as const) {
      const copy = describeActionError(api(400, code))
      expect(copy, code).not.toBe(GENERIC_ERROR_COPY)
      expect(copy, code).toMatch(pattern)
    }
  })

  it("maps the remaining wave-2 codes to plain copy", () => {
    expectMapped([
      ["profile_field_direction_unsupported", 409, /that direction/i],
      ["media_readback_missing", 502, /did not name it/i],
      ["replay_event_not_found", 404, /failed and dead-lettered/i],
    ])
  })

  // Wave 3. Each of these has a status fallback that is not merely vaguer than
  // the truth but points at the wrong action, so every case below asserts what
  // the fallback would have said as well as what the copy does.
  it("names what changed when an approver's pane is stale", () => {
    const copy = describeActionError(api(409, "approval_draft_changed"))
    expect(copy).toMatch(/changed after you opened it/i)
    expect(copy).not.toBe(describeActionError(api(409, "unheard_of")))
  })

  it("tells a privacy operator which half of the withdrawal committed", () => {
    const copy = describeActionError(api(409, "privacy_reply_withdraw_failed"))
    expect(copy).toMatch(/erased/i)
    expect(copy).toMatch(/stays open/i)
    expectMapped([
      ["privacy_request_resolved", 409, /already been completed or rejected/i],
      ["privacy_request_transition_invalid", 409, /move back to that status/i],
    ])
  })

  it("does not blame the caller for Google's own throttle", () => {
    const copy = describeActionError(api(429, "google_rate_limited"))
    expect(copy).toMatch(/google is limiting/i)
    expect(copy).not.toMatch(/too many requests/i)
  })

  // Both are Google-availability 5xx, and the difference is the only thing the
  // operator can act on: one needs a person to reconnect, the other must not
  // send them looking for a reconnect button.
  it("separates a transient token fault from an expired grant", () => {
    const transient = describeActionError(api(503, "google_token_unavailable"))
    expect(transient).not.toBe(SERVICE_UNAVAILABLE_COPY)
    expect(transient).toMatch(/no need to reconnect/i)
    expect(describeActionError(api(401, "google_reconnect_required"))).toMatch(/reconnect this account/i)
  })

  it("says an unconfirmed write may have landed, not that Google is down", () => {
    const copy = describeActionError(api(502, "google_readback_mismatch"))
    expect(copy).not.toBe(SERVICE_UNAVAILABLE_COPY)
    expect(copy).toMatch(/did not confirm/i)
    expect(copy).toMatch(/check it on google/i)
  })

  it("maps the reply and location 404s to a reload, not a hunt", () => {
    expectMapped([
      ["draft_not_found", 404, /reload the review/i],
      ["review_or_draft_not_found", 404, /reload the inbox/i],
      ["reply_not_found", 404, /no reply on this review/i],
      ["media_not_found", 404, /no longer on this location/i],
      ["place_action_not_found", 404, /no longer on this location/i],
    ])
  })
})

describe("describeActionError — status fallbacks", () => {
  it("treats an unmapped 401 as an expired session, not a generic failure", () => {
    expect(describeActionError(api(401, "unheard_of"))).toMatch(/session has expired/i)
    expect(describeActionError(api(401, "http_error"))).toMatch(/sign in again/i)
  })

  it("maps unmapped 403 / 404 / 409 / 413 / 429 by status", () => {
    expect(describeActionError(api(403, "unheard_of"))).toMatch(/permission/i)
    expect(describeActionError(api(404, "unheard_of"))).toMatch(/could not be found/i)
    expect(describeActionError(api(409, "unheard_of"))).toMatch(/refresh and try again/i)
    expect(describeActionError(api(413, "unheard_of"))).toMatch(/too large/i)
    expect(describeActionError(api(429, "unheard_of"))).toMatch(/too many requests/i)
  })

  it("treats every unmapped 5xx as temporarily unavailable", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(describeActionError(api(status, "unheard_of"))).toBe(SERVICE_UNAVAILABLE_COPY)
    }
  })

  it("prefers a mapped code over its status fallback", () => {
    expect(describeActionError(api(503, "sync_paused"))).not.toBe(SERVICE_UNAVAILABLE_COPY)
    expect(describeActionError(api(401, "google_reconnect_required"))).toMatch(/reconnect/i)
  })

  it("describes fetch network failures and falls back generically otherwise", () => {
    expect(describeActionError(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR_COPY)
    expect(describeActionError(new Error("boom"))).toBe(GENERIC_ERROR_COPY)
    expect(describeActionError(api(400, "unheard_of"))).toBe(GENERIC_ERROR_COPY)
    expect(describeActionError(undefined)).toBe(GENERIC_ERROR_COPY)
  })
})

describe("predicates", () => {
  it("flags paused sync and unlinked locations", () => {
    expect(isPausedError(api(503, "sync_paused"))).toBe(true)
    expect(isPausedError(new Error("boom"))).toBe(false)
    expect(isNotLinkedError(api(409, "google_location_not_linked"))).toBe(true)
    expect(isNotLinkedError(api(409, "location_not_linked"))).toBe(true)
    expect(isNotLinkedError(api(409, "profile_snapshot_stale"))).toBe(false)
  })
})
