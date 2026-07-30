# GGL-502 reply lifecycle certification

Run after GGL-501 against its live pilot review. This procedure intentionally
mutates and deletes a real Google reply; confirm the pilot owner has approved
the wording and timing before starting.

## Preconditions

- GGL-501 passed and its pilot review is still present.
- Staging uses the non-superuser runtime role and has
  `DRAFTS_ENABLED=true`, `PUBLISH_ENABLED=true`, and a working OpenAI key.
- The operator has owner publish authority and can inspect redacted staging
  request logs and tenant-scoped reply/attempt tables.
- The current `GOOGLE_MUTATION_TIMEOUT_MS` value and application image are
  recorded so the ambiguity drill can be reverted exactly.

## Publish and moderation

1. Open the GGL-501 review, generate an AI draft, and record the model name,
   verification verdict, and redacted draft/version IDs. Require a passing
   verification before publishing.
2. Publish once. Capture the Google `PUT .../reply` response body before local
   normalization, the route response, and the `publish_attempt_event` sequence.
   Record whether moderation appears as `reviewReplyState`,
   `reviewReply.state`, or only on a subsequent reviews read.
3. Reconcile, then call `GET /api/reviews/<local-review-uuid>`. Record the live
   reviews-list reply shape and require the UI/local status to match Google.
   A rejected reply must not have `first_published_at` and must not count as
   published.
4. Record `first_published_at`, edit the reply, verify it, and publish again.
   Require Google Maps and the API read-back to show the edited text while
   `first_published_at` remains unchanged.
5. Delete from the UI confirmation dialog. Require the provider reply to be
   absent and local `publish_status='deleted'`.
6. Publish the same edited text again. Require success and a new durable
   attempt without an idempotency conflict.
7. If the pilot owner approves a safe policy test, try one phone-number reply
   and observe whether Google produces `REJECTED`. Do not repeatedly probe
   moderation. If the provider will not deterministically reject it, record
   `BLOCKED — not reproducible on demand` and cite the fixture contract.

## Freeze the provider shapes

Redact resource IDs, people, locations, body text, request IDs, and trace data
without changing provider keys, casing, nesting, enum values, or nullability.
Update `tests/fixtures/google/review-reply-states.json` only when a live
observation differs. Record the staging capture identifier and fixture SHA-256
in `evidence/ggl-502.md`, then run:

```bash
pnpm test tests/reply-state-parsing.test.ts tests/google-contract.test.ts
pnpm test
```

## Forced ambiguity drill

1. Deploy the same staging image with `GOOGLE_MUTATION_TIMEOUT_MS=1`; do not
   change any other flag.
2. Publish a newly verified, unique body on the pilot review.
3. Require the local attempt to become `ambiguous`, with a durable `started`
   intent preceding the provider call.
4. Restore the original timeout immediately after the forced request.
5. Let the scheduler call `/api/jobs/run`. Require provider read-back before
   any new write and the event sequence:

   ```text
   started → ambiguity_checked → completed
   ```

6. Require the final local body/status to match Google and record whether the
   worker settled `succeeded`, `not_applied`, or `diverged`. Any unexplained
   divergence is a release stop.

## Pass criteria

- OpenAI draft generation, verification, publish, moderation, edit, delete, and
  identical-text republish are observed against Google.
- Live moderation fields are frozen in the contract fixture.
- The forced timeout is recovered through provider read-back without a blind
  duplicate write, and the original timeout is restored.
