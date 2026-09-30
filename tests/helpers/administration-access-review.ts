import { administrationAccessRequestSchema, administrationAccessReviewSchema } from "@/lib/contracts/google-administration-review"

export function administrationReviewFixture(input: unknown) {
  const request = administrationAccessRequestSchema.parse(input)
  const parent = request.operation === "create_admin" ? request.payload.scope === "account" ? "accounts/1" : "locations/camden" : request.payload.name.split("/").slice(0, 2).join("/")
  return administrationAccessReviewSchema.parse({
    request, parent, target: request.operation === "create_admin" ? `${parent}/admins` : request.payload.name,
    observedAt: new Date().toISOString(),
    changeSet: { id: "10000000-0000-4000-8000-000000000001", locationName: "Camden Hotel", payloadHash: "a".repeat(64), baselineHash: "b".repeat(64), payload: { request }, baseline: { collection: `${parent}/admins`, rows: [] }, updateMask: [], requestedBy: "manager", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: new Date(Date.now() + 60_000).toISOString() },
  })
}
