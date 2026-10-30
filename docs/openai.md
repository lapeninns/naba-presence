# Review AI on OpenAI

Draft generation and semantic verification use the OpenAI Responses API at
`https://api.openai.com/v1/responses`, with strict JSON schema output, local
validation, `store: false`, and a `max_output_tokens` cap taken from
`AI_MAX_OUTPUT_TOKENS` (default 4096, 256-32768).

## Configuration

- `OPENAI_API_KEY`: required for AI generation and semantic verification.
- `OPENAI_ORG_ID`: optional organisation header.
- `OPENAI_MODEL_DRAFT` and `OPENAI_MODEL_VERIFY`: default to `gpt-5.6-luna`
  and may be configured separately. OpenAI shut down `gpt-4.1-nano` and
  `gpt-4.1-nano-2025-04-14` on 23 October 2026. Existing configuration using
  either identifier resolves to the recommended replacement `gpt-5.6-luna`;
  other explicit model overrides are preserved. The resolved identifier is
  used for provider requests, reservations and stored usage.
- `OPENAI_BASE_URL`: defaults to `https://api.openai.com`; overrides are for
  local provider stubs. Keep the default in production.
- `OPENAI_TIMEOUT_MS`: defaults to 30000; maximum 55000.
- `AI_MAX_OUTPUT_TOKENS`: the per-call output cap; also the share of the
  token backstop each draft or verify reservation holds until the real usage
  arrives (`lib/server/ai-credits.ts`).

Missing credentials return `503 ai_not_configured` for AI drafting and mark the
semantic pass as skipped. `SEMANTIC_VERIFY_ENABLED=false` also skips the semantic
pass. Failed, incomplete, refused, empty, or malformed provider responses never
count as successful verification. Usage is retained on billed output errors.
Draft credits per credit period, verify-usage reservations and the token
backstop (`lib/server/ai-credits.ts`, `lib/server/ai-usage.ts`) apply to both
models. Verify reservations record `OPENAI_MODEL_VERIFY`.

## Verification

Verify model access using the intended key and organisation. Generate a
synthetic draft, then run semantic verification and independently check the
stored draft model name and verification state. Do not publish a test reply to
Google. Model access alone does not prove inference or the application journey.

The Workers AI migration documents record the previous implementation. OpenAI
is now the active provider; `WORKERS_AI_*` variables are not read.

References: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs),
[model deprecations](https://developers.openai.com/api/docs/deprecations).
