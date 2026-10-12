# Review AI on OpenAI

Draft generation and semantic verification use the OpenAI Responses API at
`https://api.openai.com/v1/responses`, with strict JSON schema output, local
validation, `store: false`, and a 4096 output-token cap.

## Configuration

- `OPENAI_API_KEY`: required for AI generation and semantic verification.
- `OPENAI_ORG_ID`: optional organisation header.
- `OPENAI_MODEL_DRAFT` and `OPENAI_MODEL_VERIFY`: default to `gpt-4.1-nano`,
  matching the previous local setup; may be configured separately.
- `OPENAI_BASE_URL`: defaults to `https://api.openai.com`; overrides are for
  local provider stubs. Keep the default in production.
- `OPENAI_TIMEOUT_MS`: defaults to 30000; maximum 55000.

Missing credentials return `503 ai_not_configured` for AI drafting and mark the
semantic pass as skipped. `SEMANTIC_VERIFY_ENABLED=false` also skips the semantic
pass. Failed, incomplete, refused, empty, or malformed provider responses never
count as successful verification. Usage is retained on billed output errors.
Existing monthly draft credits and token-budget controls continue to apply.

## Verification

Verify model access using the intended key and organisation. Generate a
synthetic draft, then run semantic verification and independently check the
stored draft model name and verification state. Do not publish a test reply to
Google. Model access alone does not prove inference or the application journey.

The Workers AI migration documents record the previous implementation. OpenAI
is now the active provider; `WORKERS_AI_*` variables are not read.

References: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs).
