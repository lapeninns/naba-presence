import { expect, type Page } from "@playwright/test"
import { completionLocationId as locationId, completionRequest as request, completionReview as review, completionAttempt as attempt, completionWorkflow as workflow } from "../../helpers/verification-completion"

export async function setupVerificationWorkspace(page: Page) {
  let disconnected = false, approved = false, executed = false, loseResponse = false
  let executions = 0, previews = 0, legacyRequests = 0
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (path === "/api/session") return route.fulfill({ json: { session: { userId: locationId, organisationId: locationId, organisationName: "Fixture Agency", displayName: "Fixture Manager", email: "fixture@example.test", role: "owner", canPublish: true } } })
    if (path === "/api/location-links") return route.fulfill({ json: { locations: [{ id: locationId, name: "Camden Hotel", linked: true, clientId: null, clientName: null }] } })
    if (path === "/api/clients") return route.fulfill({ json: { items: [], unassignedLocationCount: 1 } })
    if (path === "/api/organisations") return route.fulfill({ json: { items: [] } })
    if (path === "/api/google/connections") return route.fulfill({ json: { connections: [] } })
    if (path === "/api/reviews/counts") return route.fulfill({ json: { total: 0, byStatus: {}, byQueue: { needs_reply: 0, approval: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 } } })
    if (path === "/api/import-review/counts") return route.fulfill({ json: { counts: [] } })
    if (path.endsWith("/capabilities")) return route.fulfill({ json: { capabilities: { canEditCanonical: true, canPublish: true, resources: { administration: { state: disconnected ? "readOnly" : "available", ...(disconnected ? { reasonCode: "reconnect_required" } : {}) } } } } })
    if (path.endsWith("/summary")) return route.fulfill({ json: { summary: { locationId, linked: true, verified: false, connection: { status: "active", reconnectRequired: false, googleEmail: "fixture@example.test" }, profile: { status: "in_sync", dirtyCount: 0, observedAt: null }, hours: { status: "unknown", dirtyCount: 0, observedAt: null }, menu: { status: "unknown", dirtyCount: 0, observedAt: null, eligible: null }, booking: { count: 0, observedAt: null }, photos: { count: 0, observedAt: null }, posts: { drafts: 0, awaitingApproval: 0, failed: 0, published: 0 }, suggestions: { profile: 0, foodMenus: 0 }, lastPublish: null } } })
    if (path.endsWith("/verification-state")) return disconnected
      ? route.fulfill({ status: 409, json: { error: "google_reconnect_required", message: "Fixture disconnected" } })
      : route.fulfill({ json: { locationId, googleLocationName: "locations/camden", checkedAt: "2026-09-30T01:00:00Z", verifications: [request], merchant: null, merchantError: "verification_merchant_state_unavailable" } })
    if (path.endsWith("/verification-workflows")) return route.fulfill({ json: { workflows: url.searchParams.get("operation") === "complete" && (approved || executed)
      ? [{ ...workflow, approvedBy: approved ? locationId : null, attempt: executed ? { id: attempt.id, status: attempt.status, executionState: attempt.executionState, confirmationState: attempt.confirmationState, observedAt: attempt.observedAt } : null }] : [], nextCursor: null } })
    if (path.includes("/verification-completion-reviews")) {
      if (path.endsWith("/execute")) {
        if (method === "POST") {
          expect(route.request().postDataJSON()).toEqual({ expectedPayloadHash: review.changeSet.payloadHash, confirmation: "complete_google_location_verification", pin: "001234" })
          executions += 1; executed = true
          if (loseResponse) return route.abort("failed")
        }
        return route.fulfill({ json: { attempt } })
      }
      if (method === "POST" && path.endsWith("/verification-completion-reviews")) {
        expect(route.request().postDataJSON()).toEqual({ name: request.name, pin: "001234" }); previews += 1
      } else if (method === "POST") approved = true
      return route.fulfill({ json: { review: { ...review, changeSet: { ...review.changeSet, approvedBy: approved ? locationId : null } } } })
    }
    if (path.endsWith("/administration")) legacyRequests += 1
    return route.fulfill({ status: 503, json: { error: "fixture_unavailable", message: "No live backend is available in this browser fixture." } })
  })
  return {
    open: () => page.goto(`/listings/${locationId}/verification`),
    disconnect: () => { disconnected = true },
    loseExecutionResponse: () => { loseResponse = true },
    read: () => ({ executions, previews, legacyRequests }),
  }
}
