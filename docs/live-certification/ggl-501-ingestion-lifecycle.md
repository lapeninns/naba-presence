# GGL-501 ingestion lifecycle certification

Run only against the approved staging deployment and verified pilot listing.
Keep raw captures in an access-controlled staging log store; commit only
redacted payloads. Replace values in angle brackets before running.

## Preconditions

- `assertProductionSafety` passes at staging boot with a non-superuser
  `naba_app_runtime` login.
- Fresh database snapshot is restorable.
- Pilot Google account, verified listing, Pub/Sub topic, push subscription,
  DLQ, OIDC audience, and second reviewer account are available.
- `STAGING_BASE_URL`, an authenticated owner browser session, and a restricted
  SQL client using the staging runtime role are ready.

Stop immediately if any precondition is missing. Record the blocker in
`evidence/ggl-501.md`.

## Procedure

1. Record the application image identifier, migration ledger, tenant count,
   review count, and snapshot identifier. Do not record credentials.
2. In a clean browser profile open `${STAGING_BASE_URL}/sign-in`, choose
   **Continue with Google**, and authorize the pilot account.
3. With the staging runtime role, set the provisioned organisation context and
   verify exactly one new organisation, user, owner membership, and session.
   A query that cannot set `app.organisation_id` or that exposes another tenant
   is an immediate no-go.
4. Open `/connections`; discover accounts and locations, select the pilot
   account, and link only the approved verified location. Record redacted
   account/location resource suffixes and the local IDs.
5. Start backfill from the UI. Poll
   `GET /api/sync/backfill?external_location_id=<local-location-uuid>` until the
   checkpoint is `succeeded`. Compare local active-review count with the live
   listing total and require `providerTotals.divergence=false`.
6. Enable notifications through:

   ```http
   PATCH /api/google/notifications
   {"accountId":"<local-account-uuid>","pubsubTopic":"projects/<redacted>/topics/<redacted>"}
   ```

   Follow with
   `GET /api/google/notifications?account_id=<local-account-uuid>` and require
   both the topic and `NEW_REVIEW`/`UPDATED_REVIEW` types. Capture the redacted
   provider request and response for GGL-503.
7. From the second Google account, post a uniquely identifiable fresh review
   on the pilot listing. Record the Google-visible creation time.
8. Observe the push at staging. Require a deduplicated
   `processed_webhook_event` row with `status='processed'`, and require the
   review to appear in the inbox within 60 seconds. Capture the original HTTP
   headers and raw push body before application parsing.
9. Do not update or delete the review; GGL-502 owns mutations.
10. Trigger the cron-authenticated reconciliation route or wait for the
    scheduler tick. Require the reconcile checkpoint watermark to advance,
    zero provider-total divergence, and no failed/dead event for the capture.

## Capture and freeze

1. Copy the raw push into a scratch file outside the repository.
2. Redact project, account, location, message, review, reviewer, email, and
   trace identifiers using the rules in `lib/domain/redaction.ts`. Preserve
   field names, casing, nesting, encoded data, timestamps, and type values.
3. Replace `tests/fixtures/pubsub/new-review.json` with the redacted live shape.
4. Record its SHA-256 in `evidence/ggl-501.md` and link the redacted capture
   timestamp to the staging log identifier.
5. Run:

   ```bash
   pnpm test tests/pubsub-payload.test.ts
   pnpm test
   ```

If the unchanged parser contract fails, fix only the sanctioned payload shape
boundary in `lib/domain/pubsub-payload.ts`, retain the live fixture, and rerun
all gates.

## Pass criteria

- New-tenant provisioning succeeded under the runtime role.
- Discovery, linking, and backfill matched the provider without divergence.
- Google stored notification settings.
- A real push was processed and visible within one minute.
- Reconciliation advanced its watermark.
- The redacted real push is committed and both test commands are green.
