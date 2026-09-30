# Workers AI migration verification

Checked on 29 September 2026 in the NabaPresence platform checkout.

## Implemented

- Draft generation and semantic verification both use `@cf/zai-org/glm-5.3-flash`.
- Requests go directly to Cloudflare's account-scoped Workers AI chat-completions
  endpoint, without a Gateway ID or OpenAI credentials/fallback.
- Low reasoning effort, a 4096 completion-token cap, strict JSON schema, local
  validation, and a bounded timeout apply to both operations.
- Provider errors, invalid JSON, and truncated completions fail verification;
  the existing keyless and semantic-kill-switch behavior remains available.
- New AI drafts record the Cloudflare model name. Environment examples,
  operational instructions, and the privacy processor disclosure are updated.

## Local evidence

- `pnpm typecheck`: passed.
- `pnpm lint`: passed without warnings after removing the unused old helper.
- `pnpm test`: 231 files passed; 2369 tests passed. The normal unit run skipped
  70 files / 370 tests requiring their separately enabled environments.
- Final `pnpm build`: passed using webpack, including TypeScript and standalone
  preparation.
- `node scripts/run-test-command.mjs integration pnpm exec vitest run
  tests/integration/routes/timeouts.test.ts tests/integration/routes/approval.test.ts`:
  12 tests passed against the local database and HTTP provider stub.
- The successful route scenario returned 201, made separate generation and
  verification calls, and independently read back the stored GLM model, draft
  body, and pass/warn verification state.
- The stalled-provider scenario returned 502 `ai_timeout`; a credential-free
  generation returned 503 without a provider request. Approval boundaries passed.
- `git diff --check`: passed.

An initial integration setup encountered a missing standalone artifact; after
the build artifact was available, the tests passed. Its one leftover local test
tenant was removed with an exact ID/name/creation-time guard, and absence was
read back. A new readback assertion initially used the wrong table name; it was
corrected to the actual `draft` table before the final successful run.

The optional programming-skill audit script could not run: it imports the
TypeScript 7 `typescript/unstable/async` API, while this project uses TypeScript 5.
No dependency upgrade was made for that auxiliary tool. Project lint and the
TypeScript compiler passed, and the changed provider code was reviewed directly.

## Account evidence and activation blockers

Wrangler authenticated to account `9b153af11227b03e23dea343d5fc232f` and listed
GLM 5.3 Flash. Billing was inaccessible to that OAuth token, so the authenticated
Cloudflare dashboard was checked read-only:

- Startup credits: active, estimated USD 5000 remaining of USD 5000 granted.
- Expiry: 14 April 2027. Final balances are confirmed on monthly invoices.
- Credit coverage explicitly excludes AI Gateway and includes Workers AI with
  the programme's stated product cap.
- Active Workers subscription: Free. The Paid plan is USD 5/month plus usage.
- The upgrade preview explicitly says USD 5 due today and does not show a
  startup discount. Coverage of the initial base subscription charge is not
  confirmed; no Activate button or terms/payment checkbox was submitted.
- GLM 5.3 Flash requires Paid access for standard Workers AI billing.
- No persistent Workers AI API token is configured in the local environment;
  the previously inspected Vercel production configuration has OpenAI settings.

No subscription change, credential creation, production environment change,
deployment, or live inference was performed. Live model behavior and actual
credit deduction remain unverified until Paid access and a scoped token are
configured. The existing unrelated working-tree changes were preserved.
