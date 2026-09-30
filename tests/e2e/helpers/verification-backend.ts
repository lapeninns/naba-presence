import postgres from "postgres"
import { expect, type Page } from "@playwright/test"
import { startAppServer } from "../../integration/helpers/app-server"
import { startGoogleStub } from "../../integration/helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview } from "../../integration/helpers/tenant"

export type StartMethod = "EMAIL" | "PHONE_CALL" | "SMS" | "ADDRESS" | "AUTO"

export async function startVerificationBackend() {
  if (!process.env.DIRECT_DATABASE_URL) throw new Error("Isolated PostgreSQL required")
  const admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
  const google = await startGoogleStub()
  const organisations: string[] = []
  const server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "true", PUBLISH_ENABLED: "true", RESEND_API_KEY: "" })
  return {
    admin, google, server,
    async stop() { await server.stop(); await google.stop(); await destroyTenants(admin, organisations); await admin.end() },
    async fixture(page: Page, method: StartMethod | "VETTED_PARTNER" | "FUTURE_METHOD" = "EMAIL", pending = false) {
      const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
      const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
      const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
      const name = `${linked.googleLocationName}/verifications/browser-request`
      const address = { regionCode: "GB", addressLines: ["10 Fixture Service Road"], locality: "London", postalCode: "SW1A 1AA" }
      let applied = pending
      let phase: "PENDING" | "COMPLETED" | "FAILED" = method === "AUTO" ? "COMPLETED" : "PENDING"
      const verification = () => ({ name, method, state: phase, createTime: "2026-09-30T01:00:00Z" })
      google.reset()
      google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, title: "Fixture Service Business", serviceArea: { businessType: method === "ADDRESS" ? "CUSTOMER_LOCATION_ONLY" : "CUSTOMER_AND_BUSINESS_LOCATION" } } }))
      const option = method === "EMAIL" ? { verificationMethod: method, emailData: { user: "owner", domain: "example.test", isUserNameEditable: true } }
        : method === "ADDRESS" ? { verificationMethod: method, addressData: { business: "Fixture Service Business", address, expectedDeliveryDaysRegion: 7 } }
        : method === "PHONE_CALL" || method === "SMS" ? { verificationMethod: method, phoneNumber: "+44 20 0000 0001" } : { verificationMethod: method }
      google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [option] } }))
      google.respond({ method: "GET", pathIncludes: `${linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: applied ? [verification()] : [] } }))
      google.respond({ method: "GET", pathEndsWith: `${linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, verify: { hasPendingVerification: applied && phase === "PENDING" } } }))
      google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:verify` }, () => { applied = true; return { status: 200, json: { verification: { name, method, state: method === "AUTO" ? "COMPLETED" : "PENDING" } } } })
      google.respond({ method: "POST", pathEndsWith: `${name}:complete` }, () => { phase = "COMPLETED"; return { status: 200, json: { verification: verification() } } })
      await page.context().addCookies([{ name: "naba_session", value: owner.cookie.slice("naba_session=".length), url: server.baseUrl, httpOnly: true, sameSite: "Lax" }])
      return {
        owner, linked, connection, name, address,
        open: () => page.goto(`${server.baseUrl}/listings/${linked.locationId}/verification`),
        writes: () => google.calls.filter((call) => call.path.endsWith(":verify")),
        completionWrites: () => google.calls.filter((call) => call.path.endsWith(":complete")),
        verification,
        setPhase(value: typeof phase) { applied = true; phase = value },
        async reviewId(resource = "verification_start") {
          const [row] = await admin`select id from gbp_change_set where organisation_id = ${owner.organisationId} and resource_type = ${resource} order by created_at desc limit 1`
          expect(row).toBeDefined(); return String(row.id)
        },
        async disconnect() { await admin`update google_connection set status = 'disconnected' where id = ${connection.connectionId}` },
      }
    },
  }
}
