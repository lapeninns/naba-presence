# GGL-503 live Google contract checks

Run after GGL-501 and GGL-502. This checklist captures the Google behaviors
that local stubs cannot certify. Preserve raw traffic in restricted staging
logs and commit only redacted field-shape observations.

## 1. Notification update mask

From the GGL-501 capture, record the exact provider request:

```text
PATCH .../notificationSetting?updateMask=pubsubTopic,notificationTypes
```

Require the JSON body to contain `name`, `pubsubTopic`, and both
`NEW_REVIEW`/`UPDATED_REVIEW` notification types. A follow-up provider GET must
return both configured fields. Then PATCH an empty topic and require the
follow-up GET to show notifications removed. Restore the approved staging topic
before continuing. Compare the observation with
`lib/domain/google-contract.ts::googleNotificationSettingRequest`.

## 2. Payload casing sweep

For each restricted raw capture, add a row to the evidence table without
including customer content or resource identifiers:

| Payload | Field | Parser expectation | Live observation | Status |
|---|---|---|---|---|
| accounts page | `<field>` | `<path/casing/type>` | `<path/casing/type>` | PASS/FAIL |
| locations page | `<field>` | `<path/casing/type>` | `<path/casing/type>` | PASS/FAIL |
| reviews page | `<field>` | `<path/casing/type>` | `<path/casing/type>` | PASS/FAIL |
| single review | `<field>` | `<path/casing/type>` | `<path/casing/type>` | PASS/FAIL |
| reply PUT | `<field>` | `<path/casing/type>` | `<path/casing/type>` | PASS/FAIL |
| Pub/Sub push | `<field>` | `<path/casing/type>` | `<path/casing/type>` | PASS/FAIL |

Diff against `lib/server/reviews.ts`, `lib/server/google.ts`,
`lib/domain/pubsub-payload.ts`, and the `googleReviews` types. A mismatch is a
fix-forward at the parser boundary plus a redacted fixture update, followed by
the full test suite.

## 3. Review media

Post one photo review from the approved second account. Capture the redacted
reviews API media object, reconcile, and require `review_media_item` to contain
the same number, type, and accessible media URLs for the pilot review. Open the
inbox/detail view and verify media renders without exposing another tenant or a
decrypted Google resource name.

## 4. Voice of Merchant

For the verified pilot listing, capture the location metadata and require
`hasVoiceOfMerchant=true`, persisted `verified=true`, and successful linking.
If an approved secondary unverified listing exists, require its live response
to produce `verified=false` and require linking to fail with
`location_not_verified`. If no second listing exists, record
`BLOCKED — needs second listing`; do not alter the pilot verification state.

## 5. Refresh rotation and invalid_grant

1. Record redacted connection ID, `last_refresh_at`, and token expiry metadata.
2. Wait more than one hour without reconnecting, trigger reconciliation, and
   require a silent access-token refresh: `last_refresh_at` advances, the
   connection remains active, and other tenant work continues.
3. From the pilot Google account, revoke the application's access.
4. Trigger reconciliation. Require this connection to become `revoked`, a
   `reconnect` connection task to open, the failure to appear in the reconcile
   response, and unrelated tenants/checkpoints to continue.
5. Require the UI reconnect prompt, then complete OAuth again. Require the
   connection to recover and the reconnect task to auto-complete.

Never capture token ciphertext or OAuth tokens.

## 6. Quota and retry-after

Record the approved quota ceiling. Deploy staging with
`GOOGLE_REQUESTS_PER_SECOND` set to that value, run a pilot backfill, and
capture effective request rate, any 429 responses, `Retry-After`, retry count,
and completion time. Require paced completion with no final failure caused by
quota. Restore the prior rate immediately and record the restore timestamp.
Do not exceed the approved ceiling to manufacture a 429.

## Regression gate

After any live-shape fixture or parser change:

```bash
pnpm test tests/google-contract.test.ts \
  tests/pubsub-payload.test.ts \
  tests/reply-state-parsing.test.ts \
  tests/google-pacing.test.ts
pnpm test
```

Any unresolved field mismatch, token recovery failure, cross-tenant work stop,
or quota-induced terminal failure is a release blocker.
