# Review AI on Cloudflare Workers AI

Draft generation and semantic verification use `@cf/zai-org/glm-5.3-flash`
through the account's `/ai/v1/chat/completions` REST endpoint. The application
can remain on Vercel. There is no direct OpenAI integration or automatic fallback.

## Configuration

- `WORKERS_AI_ACCOUNT_ID`: the 32-character Cloudflare account ID owning the grant.
- `WORKERS_AI_API_TOKEN`: a persistent API token scoped to that account with
  Workers AI inference permission. Never deploy Wrangler's personal OAuth token.
- `WORKERS_AI_MODEL`: defaults to `@cf/zai-org/glm-5.3-flash`; only this model is
  accepted by this integration.
- `WORKERS_AI_BASE_URL`: defaults to `https://api.cloudflare.com`. Keep this
  default in production; the override supports local provider-stub tests.
- `WORKERS_AI_TIMEOUT_MS`: defaults to 30000, maximum 55000.

The request uses low reasoning effort, a 4096 completion-token limit, strict
JSON schema output, and `store: false`. Results are validated locally as well.
Timeouts, incomplete responses, malformed JSON, and provider failures cannot
be treated as successful semantic verification. There are no automatic retries.

Without account credentials, generation returns `503 ai_not_configured` and
semantic verification retains the existing explicitly skipped/keyless behavior.
`SEMANTIC_VERIFY_ENABLED=false` still disables the semantic pass. Configure both
credentials before deploying this migration to a production installation that
expects AI verification.

## Billing and activation

GLM 5.3 Flash requires Workers Paid access when using standard Workers AI
billing. This integration sends no AI Gateway ID and uses a Cloudflare-hosted
`@cf/` model. It does not purchase prepaid Gateway credits.

Before activation, verify that the grant is active on the selected account,
has remaining Workers AI allowance, and covers standard Workers AI usage.
An API token or successful model-catalogue query does not prove credit coverage.
Startup credit coverage and account balances must be checked separately.

Set the new account ID and API token in the intended Vercel environment, deploy
the reviewed revision, then smoke-test a synthetic draft and verification.
Confirm that new draft `model_name` values record `@cf/zai-org/glm-5.3-flash`.
Check Cloudflare usage and the grant ledger to establish actual credit deduction.
Remove legacy `OPENAI_*` environment settings after the migration is verified;
the new code ignores them. Old deployment revisions still need their old
configuration if used for rollback.

The old `OPENAI_TIMEOUT_MS` setting described in historical operational notes is
replaced by `WORKERS_AI_TIMEOUT_MS`. Preserve the 55000 ms transaction-safety cap.

References: [model](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/),
[pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[startup terms](https://www.cloudflare.com/startups/).
