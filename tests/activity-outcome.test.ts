import { describe, expect, it } from "vitest"

import { BUSINESS_INFORMATION_UPDATE_MASKS } from "@/lib/domain/business-information"
import {
  ACTIVITY_OPERATION_LABELS,
  ACTIVITY_RESOURCE_LABELS,
  OTHER_CHANGE,
  activityConfirmationLabel,
  activityErrorLabel,
  activityExecutionLabel,
  activityMaskLabel,
  activityMaskLabels,
  activityOperationLabel,
  activityResourceLabel,
  activityStatusLabel,
  activityTitle,
} from "@/lib/listings/activity-outcome"

// Every value the activity projection can carry, from the writers and CHECK
// constraints (lib/server/location-activity-projection.ts and the sources it
// unions). A new writer that adds a key must add its words here too.
const OPERATIONS = [
  "patch",
  "update_lodging",
  "start_verification",
  "complete_verification",
  "create_admin",
  "update_admin",
  "delete_admin",
  "accept_invitation",
  "decline_invitation",
  "transfer_location",
  "delete_location",
  "create_location",
  "accept_google_update",
  "publish",
  "publish_google",
  "validate",
  "validate_google",
  "reconcile",
  "import_google",
  "import_nabatable",
  "create",
  "update",
  "delete",
  "bulk_change",
  "scheduled_publication",
]
const RESOURCE_TYPES = [
  "business_info",
  "attributes",
  "lodging",
  "location_lifecycle",
  "verification",
  "account_admin",
  "location_admin",
  "invitation",
  "hours",
  "profile",
  "food_menus",
  "place_actions",
  "media",
  "posts",
  "reviews",
  "bulk",
  // bulk families (the child's `input.operation`)
  "regular_hours",
  "special_hours",
  "more_hours",
  "place_action",
  "categories",
  "post_draft",
  "photos",
  "review_approval",
  "review_template_reply",
  "mixed",
  // allowed by the database, no writer yet
  "business_calls",
  "healthcare_services",
  "healthcare_provider_attributes",
  "notifications",
]
const MASKS = [
  ...BUSINESS_INFORMATION_UPDATE_MASKS,
  "regularHours",
  "specialHours",
  "moreHours",
  "profile.description",
  "attributes/wifi",
  "menus",
  "media",
  "localPost",
  "metadata.updateTime",
  "accessibility.wheelchairAccessibleEntrance",
  "pools.pool",
]
const STATUSES = [
  "succeeded",
  "failed",
  "ambiguous",
  "started",
  "validating",
  "validated",
  "publishing",
  "importing",
  "accepted",
  "retryable",
  "superseded",
  "stale",
  "needs_resolution",
  "queued",
  "running",
  "conflict",
  "cancelled",
  "expired",
  "published",
  "rejected",
  "missed",
]

/** A raw token: snake_case, a collapsed camelCase word or a slash path. */
const RAW = /[_/]|^[a-z]+[A-Z]|\.[a-z]/

describe("activity labels in words", () => {
  it.each(OPERATIONS)("labels the operation %s", (operation) => {
    const label = activityOperationLabel(operation)
    expect(label).not.toBe(OTHER_CHANGE)
    expect(label).not.toMatch(RAW)
    expect(Object.keys(ACTIVITY_OPERATION_LABELS)).toContain(operation)
  })
  it.each(RESOURCE_TYPES)("labels the resource type %s", (type) => {
    const label = activityResourceLabel(type)
    expect(label).not.toBe(OTHER_CHANGE)
    expect(label).not.toMatch(RAW)
    expect(Object.keys(ACTIVITY_RESOURCE_LABELS)).toContain(type)
  })
  it.each(MASKS)("labels the mask key %s", (key) => {
    const label = activityMaskLabel(key)
    expect(label).not.toBe(OTHER_CHANGE)
    expect(label).not.toMatch(RAW)
  })
  it.each(STATUSES)("labels the status %s", (status) => {
    expect(activityStatusLabel(status)).not.toBe("Other")
  })

  it("reads the cases from the finding as words", () => {
    expect(activityMaskLabel("regularHours")).toBe("Regular hours")
    expect(activityTitle("publish_google", "profile")).toBe(
      "Sent to Google · Business profile"
    )
    expect(activityTitle("publish", "reviews")).toBe("Sent to Google · Reviews")
  })
  it("shows an unknown key as Other change, never the token", () => {
    expect(activityOperationLabel("do_the_thing")).toBe(OTHER_CHANGE)
    expect(activityResourceLabel("fooBar")).toBe(OTHER_CHANGE)
    expect(activityMaskLabel("someNewField")).toBe(OTHER_CHANGE)
    expect(activityTitle("do_the_thing", "fooBar")).toBe(OTHER_CHANGE)
    expect(activityStatusLabel("brand_new")).toBe("Other")
  })
  it("folds a long mask into its distinct labels", () => {
    expect(
      activityMaskLabels([
        "storefrontAddress.locality",
        "storefrontAddress.postalCode",
        "title",
        "weirdKey",
        "otherWeird",
      ])
    ).toEqual(["Address", "Business name", OTHER_CHANGE])
  })

  it("explains a failure in a sentence, never the code", () => {
    for (const code of [
      "NOT_FOUND",
      "target_changed",
      "provider_rejected",
      "google_hours_publish_failed",
      "something_new_and_unmapped",
    ]) {
      const text = activityErrorLabel(code)
      expect(text).not.toMatch(/_/)
      expect(text).not.toBe(code)
      expect(text.length).toBeGreaterThan(10)
    }
    expect(activityErrorLabel("NOT_FOUND")).not.toBe("Not found")
  })
  it("words the request and confirmation states", () => {
    expect(activityExecutionLabel("accepted")).toBe(
      "Google accepted the request"
    )
    expect(activityExecutionLabel("unrecorded")).toBeNull()
    expect(activityConfirmationLabel("unresolved")).toBe(
      "Google confirmation: not confirmed yet"
    )
    expect(activityConfirmationLabel("confirmed")).toBe(
      "Google confirmation: confirmed"
    )
    expect(activityConfirmationLabel("unrecorded")).toBeNull()
  })
})
