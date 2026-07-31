# Frontend Rebuild — Milestone 2 (Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every authentication surface — sign-in, create-account, forgot-password, reset-password, invitation acceptance, sign-out — on the Milestone 1 foundation, with the complete unhappy paths the 2026-07-31 audit found missing (resend confirmation, status-specific link errors, invalid-token recovery, accepted-vs-expired invitations, existing-session handling, rate-limit honesty, `?next=` return).

**Architecture:** Server components own auth-gating, `searchParams` reading, and invitation lookup; client form components own submission through the M1 typed API client. Validation uses the SAME zod schemas the server uses (`lib/domain/auth.ts` is pure zod and client-safe), so client and server agree by construction. Every server error code passes through one mapping layer (`lib/api/auth-errors.ts`) that turns codes into user copy plus an optional recovery action — no view invents its own error text.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, TypeScript strict, Tailwind v4 + M1 tokens, @base-ui/react primitives, TanStack Query v5, zod 4, Vitest (unit + jsdom components), Playwright + axe.

## Global Constraints

- Package manager `pnpm`. Never change the `--webpack` flags in package.json scripts.
- Branch: `frontend-rebuild-m2-auth`. Delivery model is **per-milestone merge to `main`** (changed by the product owner after M1; spec §10 amended in this branch's first commit).
- **No new dependencies** in this milestone.
- Protected paths — do NOT touch except the four sanctioned edits enumerated in Task 2: `app/api/**`, `lib/server/**`, `lib/domain/**`, `supabase/**`, `scripts/**`, `instrumentation.ts`. Everything else there stays byte-identical.
- Styling: M1 tokens only. No raw hex, no `text-[NNpx]` (use `text-caption|text-ui|text-body|text-title|text-page-title`), no hard-coded `duration-N`. House focus ring: `focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none`.
- Every form field uses the M1 `Field` system (`Field`/`FieldLabel`/`FieldDescription`/`FieldError`) so labels, `aria-invalid` and `aria-describedby` wire automatically. Never hand-roll `htmlFor`.
- Icon-only buttons require `aria-label` (enforced at the type level by `Button`).
- Copy: GB English ("organisation"), sentence case, no internal jargon, no env-flag names, no error codes shown to users.
- Every page renders exactly one `<h1>` and exactly one `<main>`.
- Post-auth landing is `/home` unless a validated `?next=` path says otherwise. Never `/reviews` (that route does not exist until M4).
- After every task: `pnpm typecheck && pnpm lint && pnpm test` green before committing; `pnpm build` green for any task touching pages.
- Commit messages: conventional commits ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `git show 4391dcb:<path>` retrieves any pre-rebuild file for visual reference (that commit is the last one before the rebuild deletion). Reference the look; do not re-admit the code.
- **How the form components are specified:** small, shared pieces ship as literal code in this plan. The four large stateful forms (`sign-in-form`, `forgot-password-form`, `reset-password-form`, `invitation-view`) are specified as a numbered behavioural contract plus a complete test file that pins every label, message, and transition verbatim. That is deliberate — the tests are the specification, and an implementation that passes them while honouring the contract and the constraints above is correct. Where the contract names a string, use it exactly; where it names a state, model it explicitly.

## File structure

```
app/
  (auth)/
    layout.tsx                     centred single-column auth frame (no dashboard shell)
    sign-in/page.tsx               server: session redirect, searchParams (status/email/next/invite)
    forgot-password/page.tsx       server: metadata + view
    reset-password/page.tsx        server: reads token_hash
  invite/[token]/page.tsx          server: invitation lookup + session-aware branching
  api/auth/password/resend/route.ts   NEW (sanctioned) — resend confirmation
components/auth/
  auth-card.tsx                    Card + real <h1> + description + footer slot
  password-field.tsx               Field-wired password input, show/hide toggle, caps-lock hint
  password-requirements.tsx        live checklist mirroring lib/domain/auth passwordSchema
  auth-error-alert.tsx             renders a mapped AuthMessage (+ optional recovery action)
  sign-in-form.tsx                 client: sign-in / create-account modes
  forgot-password-form.tsx         client
  reset-password-form.tsx          client: token states + form
  resend-confirmation-button.tsx   client: inline resend action with sent/cooldown state
  invitation-actions.tsx           client: accept-as-current-user / sign-out-and-continue
lib/api/
  auth.ts                          typed auth calls (zod-validated) over apiFetch
  auth-errors.ts                   code → {title, description, action} mapping (single source)
  next-path.ts                     sanitiseNextPath() open-redirect guard
lib/server/password-auth.ts        MODIFY (sanctioned): resendConfirmationEmail + 429 on reset
app/api/invitations/[token]/route.ts  MODIFY (sanctioned): accepted separate from expired
app/auth/confirm/route.ts          MODIFY (sanctioned): success → /home
tests/components/…                 component tests per task
tests/integration/routes/auth-additions.test.ts  NEW: the sanctioned backend additions
tests/e2e/auth.spec.ts             NEW: auth journeys + axe
```

---

### Task 1: Shared auth UI kit

**Files:**
- Create: `components/auth/auth-card.tsx`, `components/auth/password-field.tsx`, `components/auth/password-requirements.tsx`, `app/(auth)/layout.tsx`
- Test: `tests/components/auth-kit.test.tsx`

**Interfaces:**
- Consumes: `Card`/`CardContent`/`CardDescription` from `@/components/ui/card`; `Field`/`FieldLabel`/`FieldError`/`FieldDescription` from `@/components/ui/field`; `Input` from `@/components/ui/input`; `Button` from `@/components/ui/button`; `cn` from `@/lib/utils`; `passwordSchema` from `@/lib/domain/auth`.
- Produces (later tasks depend on these exact signatures):
  - `AuthCard({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode })` — renders the page's single `<h1>` (`text-page-title`) inside a Card.
  - `PasswordField({ label, name, value, onValueChange, autoComplete, error, describedBy, autoFocus }: { label: string; name: string; value: string; onValueChange: (v: string) => void; autoComplete: "current-password" | "new-password"; error?: string; describedBy?: React.ReactNode; autoFocus?: boolean })` — Field-wired input with a show/hide toggle button and a caps-lock hint.
  - `PasswordRequirements({ value }: { value: string })` — live checklist; each rule shows met/unmet with a non-colour cue and an accessible name.
  - `checkPasswordRules(value: string): { id: string; label: string; met: boolean }[]` — exported from `password-requirements.tsx`, rule ids `length`, `letter`, `number`, `symbol`.

- [ ] **Step 1: Write the failing tests**

`tests/components/auth-kit.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AuthCard } from "@/components/auth/auth-card"
import { PasswordField } from "@/components/auth/password-field"
import {
  PasswordRequirements,
  checkPasswordRules,
} from "@/components/auth/password-requirements"

describe("AuthCard", () => {
  it("renders the page's single h1", () => {
    render(<AuthCard title="Sign in">body</AuthCard>)
    expect(
      screen.getByRole("heading", { level: 1, name: "Sign in" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })
})

describe("PasswordField", () => {
  function Harness({ error }: { error?: string } = {}) {
    return (
      <PasswordField
        label="Password"
        name="password"
        value="secret"
        onValueChange={() => {}}
        autoComplete="current-password"
        error={error}
      />
    )
  }

  it("is labelled, masked, and carries the autocomplete hint", () => {
    render(<Harness />)
    const input = screen.getByLabelText("Password")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toHaveAttribute("autocomplete", "current-password")
  })

  it("toggles visibility from a labelled button", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Show password" }))
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text")
    await user.click(screen.getByRole("button", { name: "Hide password" }))
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password")
  })

  it("wires errors through the Field system", () => {
    render(<Harness error="Enter your password." />)
    const input = screen.getByLabelText("Password")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription("Enter your password.")
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your password.")
  })

  it("calls onValueChange as the user types", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <PasswordField
        label="Password"
        name="password"
        value=""
        onValueChange={onValueChange}
        autoComplete="new-password"
      />
    )
    await user.type(screen.getByLabelText("Password"), "a")
    expect(onValueChange).toHaveBeenCalledWith("a")
  })
})

describe("password requirements", () => {
  it("evaluates every rule", () => {
    expect(checkPasswordRules("short")).toEqual([
      { id: "length", label: "At least 12 characters", met: false },
      { id: "letter", label: "A letter", met: true },
      { id: "number", label: "A number", met: false },
      { id: "symbol", label: "A symbol", met: false },
    ])
    expect(
      checkPasswordRules("correct-horse-9").every((rule) => rule.met)
    ).toBe(true)
  })

  it("announces met and unmet rules without relying on colour", () => {
    render(<PasswordRequirements value="correct-horse-9" />)
    expect(
      screen.getByRole("listitem", { name: "Met: At least 12 characters" })
    ).toBeInTheDocument()
    render(<PasswordRequirements value="short" />)
    expect(
      screen.getByRole("listitem", { name: "Not yet met: A number" })
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/auth-kit.test.tsx --project components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the kit**

`app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-5 py-10">
      {children}
    </div>
  )
}
```

`components/auth/auth-card.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"

function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main id="main" tabIndex={-1} className="w-full max-w-md">
      <Card>
        <CardHeader className="gap-1.5">
          <h1 className="text-page-title font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
      {footer ? (
        <div className="mt-4 text-center text-ui text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </main>
  )
}

export { AuthCard }
```

Note: `CardHeader`/`CardContent` props come from `components/ui/card.tsx` — read it before writing and match the actual export names and their default classes.

`components/auth/password-field.tsx`:

```tsx
"use client"

import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

function PasswordField({
  label,
  name,
  value,
  onValueChange,
  autoComplete,
  error,
  describedBy,
  autoFocus,
}: {
  label: string
  name: string
  value: string
  onValueChange: (value: string) => void
  autoComplete: "current-password" | "new-password"
  error?: string
  describedBy?: React.ReactNode
  autoFocus?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  return (
    <Field error={error}>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="pr-10"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyUp={(event) =>
            setCapsLock(event.getModifierState?.("CapsLock") ?? false)
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      {capsLock ? (
        <FieldDescription>Caps Lock is on.</FieldDescription>
      ) : describedBy ? (
        <FieldDescription>{describedBy}</FieldDescription>
      ) : null}
      <FieldError />
    </Field>
  )
}

export { PasswordField }
```

Caveat to honour: the M1 `Field` only adds `descriptionId` to `aria-describedby` while a `FieldDescription` is mounted, so the conditional above is safe. The `describedBy` slot is how the create-account form attaches its requirements checklist.

`components/auth/password-requirements.tsx`:

```tsx
import { Check, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

type PasswordRule = { id: string; label: string; met: boolean }

// Mirrors passwordSchema in lib/domain/auth.ts. Both must change together;
// the server remains the authority and re-validates every submission.
function checkPasswordRules(value: string): PasswordRule[] {
  return [
    { id: "length", label: "At least 12 characters", met: value.length >= 12 },
    { id: "letter", label: "A letter", met: /[A-Za-z]/.test(value) },
    { id: "number", label: "A number", met: /[0-9]/.test(value) },
    { id: "symbol", label: "A symbol", met: /[^A-Za-z0-9]/.test(value) },
  ]
}

function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {checkPasswordRules(value).map((rule) => (
        <li
          key={rule.id}
          aria-label={`${rule.met ? "Met" : "Not yet met"}: ${rule.label}`}
          className={cn(
            "flex items-center gap-1.5 text-caption",
            rule.met ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {rule.met ? (
            <Check className="size-3.5 text-success" aria-hidden />
          ) : (
            <Circle className="size-3.5" aria-hidden />
          )}
          {rule.label}
        </li>
      ))}
    </ul>
  )
}

export { PasswordRequirements, checkPasswordRules }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/auth-kit.test.tsx --project components`
Expected: PASS (7 tests). If `getByRole("listitem", { name })` does not match, the accessible name is coming from the `aria-label` — keep the assertion and fix the markup, never the other way round.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/auth app/\(auth\)/layout.tsx tests/components/auth-kit.test.tsx
git commit -m "feat: shared auth ui kit (card, password field, requirements)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Sanctioned backend additions

**Files:**
- Create: `app/api/auth/password/resend/route.ts`
- Modify: `lib/server/password-auth.ts` (add `resendConfirmationEmail`; make `requestPasswordReset` surface 429), `app/api/invitations/[token]/route.ts` (report `accepted` separately from `expired`), `app/auth/confirm/route.ts` (success redirect `/reviews` → `/home`)
- Test: `tests/integration/routes/auth-additions.test.ts`; update `tests/integration/routes/invitations.test.ts` if it asserts the old response shape

**Interfaces:**
- Produces (Task 3 consumes):
  - `POST /api/auth/password/resend` — body `{ email: string }`; `202 { accepted: true }` always, except `429 { error: "auth_rate_limited" }`. Never reveals whether an account exists.
  - `GET /api/invitations/{token}` — response gains `accepted: boolean`; `expired` now means time-expiry ONLY.
  - `/auth/confirm` success → `303` to `/home`.
- Consumes: `providerRequest`, `AuthProviderError`, `ApiError` (already in `lib/server/password-auth.ts`); `resetRequestSchema` shape for the resend body (define a local `resendSchema` — do not widen the shared one).

- [ ] **Step 1: Write the failing integration tests**

`tests/integration/routes/auth-additions.test.ts`:

```ts
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("auth additions", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("accepts a resend request without disclosing account existence", async () => {
    // PASSWORD_AUTH_ENABLED is false in this harness, so the provider is never
    // reached; the route must still validate input and refuse to leak.
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@nabapresence.test" }),
      }
    )
    expect([202, 503]).toContain(response.status)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain("not found")
  })

  it("rejects a malformed resend request", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("invalid_request")
  })

  it("reports accepted invitations separately from expired ones", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const token = "m2-accepted-invitation-token-value"
    const { createHash } = await import("node:crypto")
    const tokenHash = createHash("sha256").update(token).digest("hex")
    await admin`
      insert into invitation (
        organisation_id, email, role, token_hash, expires_at, accepted_at
      )
      values (
        ${tenant.organisationId},
        'invited@nabapresence.test',
        'member',
        ${tokenHash},
        now() + interval '7 days',
        now()
      )
    `
    const response = await fetch(
      `${server.baseUrl}/api/invitations/${token}`
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.accepted).toBe(true)
    expect(body.expired).toBe(false)
  })
})
```

Before running: read `supabase/migrations/0001_initial.sql` for the real `invitation` column set (the insert above must match it — add any NOT NULL columns such as `invited_by_user_id` using `tenant.userId`, and use the real role enum value).

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/auth-additions.test.ts`
Expected: FAIL — the resend route 404s and `accepted` is undefined.

- [ ] **Step 3: Implement the four sanctioned edits**

3a. `lib/server/password-auth.ts` — add after `requestPasswordReset`:

```ts
export async function resendConfirmationEmail(
  email: string,
  redirectTo: string
): Promise<void> {
  try {
    await providerRequest(
      `/resend?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "signup",
          email: email.trim().toLowerCase(),
        }),
      }
    )
  } catch (error) {
    if (error instanceof AuthProviderError) {
      if (error.status === 429) {
        throw new ApiError(
          429,
          "auth_rate_limited",
          "Too many attempts. Try again later."
        )
      }
      // Never disclose whether the address belongs to an account.
      return
    }
    throw error
  }
}
```

3b. Same file — `requestPasswordReset`'s catch currently swallows every provider error. Rate limiting is not account existence, so surface it:

```ts
  } catch (error) {
    // Password reset must not disclose whether an account exists. Rate limiting
    // is not account information, so it is surfaced; everything else stays uniform.
    if (error instanceof AuthProviderError) {
      if (error.status === 429) {
        throw new ApiError(
          429,
          "auth_rate_limited",
          "Too many attempts. Try again later."
        )
      }
      return
    }
    throw error
  }
```

3c. `app/api/auth/password/resend/route.ts` (mirror the sibling reset-request route's structure):

```ts
import { NextResponse } from "next/server"
import { z } from "zod"

import { emailSchema } from "@/lib/domain/auth"
import { getServerEnv } from "@/lib/server/env"
import { apiError } from "@/lib/server/http"
import { resendConfirmationEmail } from "@/lib/server/password-auth"

export const runtime = "nodejs"

const resendSchema = z.object({ email: emailSchema })

export async function POST(request: Request) {
  try {
    const input = resendSchema.parse(await request.json())
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const confirmationUrl = new URL("/auth/confirm", baseUrl)
    confirmationUrl.searchParams.set("flow", "signup")
    await resendConfirmationEmail(input.email, confirmationUrl.toString())
    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (error) {
    return apiError(error)
  }
}
```

3d. `app/api/invitations/[token]/route.ts` — replace the response object:

```ts
    const accepted = invitation.acceptedAt !== null
    return NextResponse.json({
      organisationName: invitation.organisationName,
      email: invitation.email,
      accepted,
      expired: !accepted && invitation.expiresAt.getTime() <= Date.now(),
    })
```

3e. `app/auth/confirm/route.ts` — the success redirect target only:

```ts
    return NextResponse.redirect(new URL("/home", baseUrl))
```

Then check `tests/integration/routes/invitations.test.ts` (around line 158) for an assertion on the old shape; if it uses `toEqual` with `expired: false`, extend it with `accepted: false` rather than loosening the matcher.

- [ ] **Step 4: Run to verify pass**

Run: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/auth-additions.test.ts tests/integration/routes/invitations.test.ts tests/integration/routes/password-auth.test.ts`
Expected: PASS. Then the whole backend suite must stay green:
Run: `node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add lib/server/password-auth.ts app/api/auth/password/resend app/api/invitations app/auth/confirm tests/integration
git commit -m "feat: resend confirmation, rate-limit honesty, accepted invitations, /home landing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Auth API client, error mapping, and 204 handling

**Files:**
- Create: `lib/api/auth.ts`, `lib/api/auth-errors.ts`, `lib/api/next-path.ts`
- Modify: `lib/api/client.ts` (204/empty-body handling — the M1 final review's flagged carry-forward, whose first consumer is `signOut`)
- Test: `tests/components/auth-api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiClientError` from `@/lib/api/client`.
- Produces (Tasks 4-7 consume these EXACT signatures):
  - `signIn(input: { email: string; password: string; inviteToken?: string }): Promise<void>`
  - `register(input: { displayName: string; email: string; password: string; inviteToken?: string }): Promise<{ authenticated: boolean; confirmationRequired: boolean }>`
  - `requestPasswordReset(email: string): Promise<void>`
  - `completePasswordReset(input: { tokenHash: string; password: string }): Promise<void>`
  - `resendConfirmation(email: string): Promise<void>`
  - `signOut(): Promise<void>`
  - `lookupInvitation(token: string): Promise<{ organisationName: string; email: string; accepted: boolean; expired: boolean }>`
  - `type AuthMessage = { title: string; description?: string; action?: "resend-confirmation" | "request-reset-link" }`
  - `authErrorMessage(error: unknown): AuthMessage`
  - `confirmStatusMessage(status: string): AuthMessage`
  - `fieldErrorsFrom(error: unknown): Record<string, string>` — maps a 400 `invalid_request` zod `details` array to `{ fieldName: firstMessage }`
  - `sanitiseNextPath(value: string | null | undefined): string | null` — returns the value only when it is a same-site absolute path

- [ ] **Step 1: Write the failing tests**

`tests/components/auth-api.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClientError, apiFetch } from "@/lib/api/client"
import {
  authErrorMessage,
  confirmStatusMessage,
  fieldErrorsFrom,
} from "@/lib/api/auth-errors"
import { sanitiseNextPath } from "@/lib/api/next-path"
import { signOut } from "@/lib/api/auth"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("sanitiseNextPath", () => {
  it("accepts same-site absolute paths", () => {
    expect(sanitiseNextPath("/inbox?queue=needs_reply")).toBe(
      "/inbox?queue=needs_reply"
    )
  })
  it("rejects anything that could leave the site", () => {
    for (const value of [
      null,
      undefined,
      "",
      "inbox",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      expect(sanitiseNextPath(value)).toBeNull()
    }
  })
})

describe("authErrorMessage", () => {
  it("offers a resend action for unconfirmed accounts", () => {
    const message = authErrorMessage(
      new ApiClientError(403, "email_not_verified", "server copy")
    )
    expect(message.action).toBe("resend-confirmation")
    expect(message.title).not.toContain("email_not_verified")
  })

  it("maps invalid credentials without leaking which field was wrong", () => {
    const message = authErrorMessage(
      new ApiClientError(401, "invalid_credentials", "server copy")
    )
    expect(message.title).toBe("That email or password is incorrect.")
    expect(message.action).toBeUndefined()
  })

  it("maps rate limiting and provider outages distinctly", () => {
    expect(
      authErrorMessage(new ApiClientError(429, "auth_rate_limited", "x")).title
    ).toBe("Too many attempts.")
    expect(
      authErrorMessage(
        new ApiClientError(503, "password_auth_disabled", "x")
      ).title
    ).toBe("Sign-in is temporarily unavailable.")
  })

  it("falls back safely for unknown errors", () => {
    const message = authErrorMessage(new Error("boom"))
    expect(message.title).toBe("Something went wrong.")
    expect(JSON.stringify(message)).not.toContain("boom")
  })
})

describe("confirmStatusMessage", () => {
  it("distinguishes an expired invitation from a bad link", () => {
    expect(confirmStatusMessage("invitation_expired").title).toBe(
      "That invitation has expired."
    )
    expect(confirmStatusMessage("invalid_email_link").title).toBe(
      "That link is invalid or has expired."
    )
    expect(confirmStatusMessage("anything-else").title).toBe(
      "That link is invalid or has expired."
    )
  })
})

describe("fieldErrorsFrom", () => {
  it("maps zod issue paths to field messages", () => {
    const error = new ApiClientError(400, "invalid_request", "x", [
      { path: ["password"], message: "Include at least one number." },
      { path: ["password"], message: "later duplicate" },
      { path: ["email"], message: "Enter a valid email address." },
    ])
    expect(fieldErrorsFrom(error)).toEqual({
      password: "Include at least one number.",
      email: "Enter a valid email address.",
    })
  })
  it("returns nothing for other errors", () => {
    expect(fieldErrorsFrom(new ApiClientError(500, "internal_error", "x"))).toEqual({})
  })
})

describe("signOut", () => {
  it("resolves on a 204 with no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    await expect(signOut()).resolves.toBeUndefined()
  })
})

describe("apiFetch 204", () => {
  it("returns undefined instead of an empty string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    await expect(apiFetch("/api/probe", { method: "DELETE" })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/auth-api.test.tsx --project components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/api/next-path.ts`:

```ts
/**
 * Only same-site absolute paths may be used as a post-auth destination.
 * Anything protocol-relative ("//host"), backslash-smuggled ("/\\host"),
 * scheme-bearing, or relative is refused so ?next= cannot become an open
 * redirect.
 */
export function sanitiseNextPath(
  value: string | null | undefined
): string | null {
  if (!value) return null
  if (!value.startsWith("/")) return null
  if (value.startsWith("//") || value.startsWith("/\\")) return null
  return value
}
```

`lib/api/auth-errors.ts`:

```ts
import { ApiClientError } from "./client"

export type AuthMessage = {
  title: string
  description?: string
  action?: "resend-confirmation" | "request-reset-link"
}

const GENERIC: AuthMessage = {
  title: "Something went wrong.",
  description: "Try again in a moment.",
}

const BY_CODE: Record<string, AuthMessage> = {
  invalid_credentials: {
    title: "That email or password is incorrect.",
    description: "Check both and try again.",
  },
  email_not_verified: {
    title: "Confirm your email address to continue.",
    description:
      "We sent a confirmation link when the account was created. Open it, then sign in.",
    action: "resend-confirmation",
  },
  auth_rate_limited: {
    title: "Too many attempts.",
    description: "Wait a minute, then try again.",
  },
  password_auth_disabled: {
    title: "Sign-in is temporarily unavailable.",
    description: "This is a problem on our side. Try again shortly.",
  },
  auth_provider_unavailable: {
    title: "Sign-in is temporarily unavailable.",
    description: "This is a problem on our side. Try again shortly.",
  },
  verified_email_required: {
    title: "Your account needs a confirmed email address.",
    description: "Confirm the address you signed up with, then try again.",
  },
  invalid_email_link: {
    title: "That link is invalid or has expired.",
    description: "Request a fresh one and try again.",
    action: "request-reset-link",
  },
  password_reset_failed: {
    title: "That reset link is no longer valid.",
    description: "Request a fresh one and try again.",
    action: "request-reset-link",
  },
  invitation_expired: {
    title: "That invitation has expired.",
    description: "Ask an organisation owner or admin to send a new one.",
  },
  invitation_not_found: {
    title: "We could not find that invitation.",
    description: "Check the link, or ask for a new invitation.",
  },
  auth_identity_conflict: {
    title: "That email is already linked to another account.",
    description: "Sign in with the original account, or use a different email.",
  },
  invalid_request: {
    title: "Check the highlighted fields.",
  },
}

export function authErrorMessage(error: unknown): AuthMessage {
  if (error instanceof ApiClientError) {
    return BY_CODE[error.code] ?? GENERIC
  }
  return GENERIC
}

export function confirmStatusMessage(status: string): AuthMessage {
  return BY_CODE[status] ?? BY_CODE.invalid_email_link
}

export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError) || error.code !== "invalid_request") {
    return {}
  }
  const issues = error.details
  if (!Array.isArray(issues)) return {}
  const fields: Record<string, string> = {}
  for (const issue of issues) {
    const path = (issue as { path?: unknown[] }).path
    const message = (issue as { message?: unknown }).message
    const key = Array.isArray(path) ? String(path[0] ?? "") : ""
    if (key && typeof message === "string" && !(key in fields)) {
      fields[key] = message
    }
  }
  return fields
}
```

`lib/api/client.ts` — inside `apiFetch`, immediately after the `!response.ok` block and before schema handling, add:

```ts
  // 204/empty bodies carry no payload; returning "" would fail every schema
  // and surprise callers such as signOut.
  if (response.status === 204) return undefined as T
```

Keep `readPayload`'s existing behaviour untouched for every other status.

`lib/api/auth.ts`:

```ts
import { z } from "zod"

import { apiFetch } from "./client"

const registerResponseSchema = z.object({
  authenticated: z.boolean(),
  confirmationRequired: z.boolean().optional(),
})

const invitationSchema = z.object({
  organisationName: z.string(),
  email: z.string(),
  accepted: z.boolean(),
  expired: z.boolean(),
})

export async function signIn(input: {
  email: string
  password: string
  inviteToken?: string
}): Promise<void> {
  await apiFetch("/api/auth/password/login", { method: "POST", body: input })
}

export async function register(input: {
  displayName: string
  email: string
  password: string
  inviteToken?: string
}): Promise<{ authenticated: boolean; confirmationRequired: boolean }> {
  const result = await apiFetch("/api/auth/password/register", {
    method: "POST",
    body: input,
    schema: registerResponseSchema,
  })
  return {
    authenticated: result.authenticated,
    confirmationRequired: result.confirmationRequired ?? !result.authenticated,
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiFetch("/api/auth/password/reset/request", {
    method: "POST",
    body: { email },
  })
}

export async function completePasswordReset(input: {
  tokenHash: string
  password: string
}): Promise<void> {
  await apiFetch("/api/auth/password/reset/complete", {
    method: "POST",
    body: input,
  })
}

export async function resendConfirmation(email: string): Promise<void> {
  await apiFetch("/api/auth/password/resend", {
    method: "POST",
    body: { email },
  })
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/session", { method: "DELETE" })
}

export async function lookupInvitation(token: string) {
  return apiFetch(`/api/invitations/${encodeURIComponent(token)}`, {
    schema: invitationSchema,
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/auth-api.test.tsx --project components`
Expected: PASS (11 tests). Then confirm the M1 client tests still pass:
Run: `pnpm exec vitest run tests/components/api-client.test.tsx --project components`

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/api tests/components/auth-api.test.tsx
git commit -m "feat: auth api client, single error-copy mapping, 204 handling, next-path guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Sign-in and create-account

**Files:**
- Create: `app/(auth)/sign-in/page.tsx`, `components/auth/sign-in-form.tsx`, `components/auth/auth-error-alert.tsx`, `components/auth/resend-confirmation-button.tsx`
- Modify: `tests/integration/routes/sign-in.test.ts` (un-skip the sign-in page test)
- Test: `tests/components/sign-in-form.test.tsx`

**Interfaces:**
- Consumes: `AuthCard`, `PasswordField`, `PasswordRequirements` (Task 1); `signIn`, `register`, `resendConfirmation`, `authErrorMessage`, `fieldErrorsFrom`, `confirmStatusMessage`, `sanitiseNextPath`, `type AuthMessage` (Task 3); `loginSchema`, `registerSchema` from `@/lib/domain/auth`; `Field`/`FieldLabel`/`FieldError`, `Input`, `Button`, `Alert`/`AlertTitle`/`AlertDescription` from `components/ui`; `getSession` from `@/lib/server/session` (server page only).
- Produces (Tasks 5-6 consume): `AuthErrorAlert({ message, email }: { message: AuthMessage; email?: string })` — renders an `Alert` and, when `message.action` is set, the matching recovery control (`resend-confirmation` → `ResendConfirmationButton`; `request-reset-link` → a link to `/forgot-password`). `ResendConfirmationButton({ email }: { email: string })` — sends once, then shows a sent confirmation and disables for the rest of the page's life. `SignInForm({ initialMode, inviteToken, invitedEmail, nextPath, statusMessage }: { initialMode?: "sign-in" | "create-account"; inviteToken?: string; invitedEmail?: string; nextPath?: string | null; statusMessage?: AuthMessage })`.

- [ ] **Step 1: Write the failing tests**

`tests/components/sign-in-form.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SignInForm } from "@/components/auth/sign-in-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/sign-in", search: "", assign })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe("sign-in mode", () => {
  it("submits credentials and lands on /home", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue(undefined)
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/home"))
    expect(authApi.signIn).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "correct-horse-9",
      inviteToken: undefined,
    })
  })

  it("honours a validated next path", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue(undefined)
    render(<SignInForm nextPath="/inbox?queue=needs_reply" />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/inbox?queue=needs_reply")
    )
  })

  it("shows mapped copy and offers resend when the email is unconfirmed", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockRejectedValue(
      new ApiClientError(403, "email_not_verified", "server copy")
    )
    const resend = vi
      .spyOn(authApi, "resendConfirmation")
      .mockResolvedValue(undefined)
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Confirm your email address to continue.")
    expect(alert).not.toHaveTextContent("server copy")
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )
    await waitFor(() => expect(resend).toHaveBeenCalledWith("a@example.test"))
    expect(
      await screen.findByText("Confirmation email sent.")
    ).toBeInTheDocument()
  })

  it("prevents double submission while a request is in flight", async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    vi.spyOn(authApi, "signIn").mockImplementation(
      () => new Promise<void>((resolve) => { release = () => resolve() })
    )
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    const submit = screen.getByRole("button", { name: "Sign in" })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(authApi.signIn).toHaveBeenCalledTimes(1)
    release()
  })

  it("renders a status message passed from the confirmation redirect", () => {
    render(
      <SignInForm
        statusMessage={{ title: "That invitation has expired.", description: "Ask for a new one." }}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That invitation has expired."
    )
  })
})

describe("create-account mode", () => {
  it("validates locally before calling the server", async () => {
    const user = userEvent.setup()
    const registerSpy = vi.spyOn(authApi, "register")
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "tooshort")
    await user.type(screen.getByLabelText("Confirm password"), "tooshort")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(registerSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("Password")).toHaveFocus()
  })

  it("reports mismatched confirmation without contacting the server", async () => {
    const user = userEvent.setup()
    const registerSpy = vi.spyOn(authApi, "register")
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-8")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(registerSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription(
      "Both passwords must match."
    )
  })

  it("shows the check-your-email state when confirmation is required", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "register").mockResolvedValue({
      authenticated: false,
      confirmationRequired: true,
    })
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(
      await screen.findByRole("heading", { name: "Check your email" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Resend confirmation email" })
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("locks the email field for an invited address", () => {
    render(
      <SignInForm
        initialMode="create-account"
        inviteToken="tok"
        invitedEmail="invited@example.test"
      />
    )
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveValue("invited@example.test")
    expect(email).toHaveAttribute("readonly")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/sign-in-form.test.tsx --project components`
Expected: FAIL — `@/components/auth/sign-in-form` not found.

- [ ] **Step 3: Implement the alert, resend button, form, and page**

`components/auth/auth-error-alert.tsx`:

```tsx
"use client"

import Link from "next/link"

import { ResendConfirmationButton } from "@/components/auth/resend-confirmation-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { AuthMessage } from "@/lib/api/auth-errors"

function AuthErrorAlert({
  message,
  email,
}: {
  message: AuthMessage
  email?: string
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{message.title}</AlertTitle>
      {message.description || message.action ? (
        <AlertDescription className="flex flex-col items-start gap-2">
          {message.description ? <span>{message.description}</span> : null}
          {message.action === "resend-confirmation" && email ? (
            <ResendConfirmationButton email={email} />
          ) : null}
          {message.action === "request-reset-link" ? (
            <Link href="/forgot-password" className="underline underline-offset-4">
              Request another link
            </Link>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

export { AuthErrorAlert }
```

Read `components/ui/alert.tsx` first: it exports `AlertAction` too, and its variants include `destructive`. Use `AlertAction` instead of a bare `Link` if that is what the primitive expects for actions.

`components/auth/resend-confirmation-button.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { resendConfirmation } from "@/lib/api/auth"
import { authErrorMessage } from "@/lib/api/auth-errors"

function ResendConfirmationButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle")
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (state === "sent") {
    return (
      <span className="text-ui" role="status">
        Confirmation email sent.
      </span>
    )
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              await resendConfirmation(email)
              setState("sent")
            } catch (error) {
              setFailure(authErrorMessage(error).title)
              setState("failed")
            }
          })
        }
      >
        {pending ? "Sending…" : "Resend confirmation email"}
      </Button>
      {state === "failed" && failure ? (
        <span className="text-caption text-destructive" role="alert">
          {failure}
        </span>
      ) : null}
    </span>
  )
}

export { ResendConfirmationButton }
```

`components/auth/sign-in-form.tsx` — a client component holding the whole flow. Requirements the tests pin, all of which must be implemented literally:

1. State: `mode` (`initialMode ?? "sign-in"`), `displayName`, `email` (seeded from `invitedEmail`), `password`, `confirmPassword`, `fieldErrors: Record<string,string>`, `message: AuthMessage | null` (seeded from `statusMessage`), `stage: "form" | "confirm-sent"`, plus a `useTransition` pending flag.
2. Labels exactly: `Your name`, `Email address`, `Password`, `Confirm password`. Submit button label `Sign in` / `Create account`; while pending, `Signing in…` / `Creating account…` and `disabled`.
3. Email field: `Field` + `FieldLabel` + `Input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}`; `readOnly` when `invitedEmail` is set.
4. Password fields use `PasswordField` (`current-password` in sign-in mode; `new-password` for both fields in create mode). In create mode, pass `<PasswordRequirements value={password} />` as `describedBy` on the first password field.
5. Client validation before any network call: sign-in → `loginSchema.safeParse`; create → `registerSchema.safeParse` PLUS a manual `password === confirmPassword` check whose message is exactly `Both passwords must match.` on the `confirmPassword` field. On failure set `fieldErrors` and move focus to the first invalid input (`document.getElementById` of that field's input, or a ref map) — the test asserts `toHaveFocus()`.
6. Submit: sign-in → `signIn({ email, password, inviteToken })`; on success `window.location.assign(nextPath ?? "/home")` and DO NOT clear the pending flag (prevents the double-submit window the audit flagged). Create → `register({ displayName, email, password, inviteToken })`; when the result is `authenticated` navigate the same way, otherwise set `stage = "confirm-sent"`.
7. Errors: `setFieldErrors(fieldErrorsFrom(error))` and `setMessage(authErrorMessage(error))`; render `<AuthErrorAlert message={message} email={email} />` above the fields; move focus to the alert when there are no field-level errors.
8. `stage === "confirm-sent"` renders a heading `Check your email` (level 2 inside the card's h1), the address, guidance to open the link, `<ResendConfirmationButton email={email} />`, and a `Back to sign in` button that returns to `stage: "form"`, `mode: "sign-in"`.
9. Mode toggle: two buttons inside a `role="group"` labelled `Account action`, each with `aria-pressed`. Switching modes clears `fieldErrors` and `message`.
10. The whole thing is one `<form onSubmit>` so Enter submits.

`app/(auth)/sign-in/page.tsx`:

```tsx
import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { SignInForm } from "@/components/auth/sign-in-form"
import { confirmStatusMessage } from "@/lib/api/auth-errors"
import { sanitiseNextPath } from "@/lib/api/next-path"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Sign in · NabaPresence" }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    next?: string
    invite?: string
    mode?: string
  }>
}) {
  const params = await searchParams
  const nextPath = sanitiseNextPath(params.next)
  const session = await getSession()
  if (session) redirect(nextPath ?? "/home")
  return (
    <AuthCard
      title="Sign in to NabaPresence"
      description="Google Business Profile is connected separately by an organisation owner, so there is no Google sign-in here."
      footer={
        <a className="underline underline-offset-4" href="/forgot-password">
          Forgot your password?
        </a>
      }
    >
      <SignInForm
        initialMode={params.mode === "create-account" ? "create-account" : "sign-in"}
        inviteToken={params.invite}
        nextPath={nextPath}
        statusMessage={
          params.status ? confirmStatusMessage(params.status) : undefined
        }
      />
    </AuthCard>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/sign-in-form.test.tsx --project components`
Expected: PASS (9 tests).

- [ ] **Step 5: Un-skip the sign-in integration test and verify**

In `tests/integration/routes/sign-in.test.ts`, change the `it.skip` marked `// re-enable: rebuild M2` back to `it` and delete that comment line. Leave the two M4-marked skips alone.

```bash
pnpm build
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration/routes/sign-in.test.ts
```

Expected: PASS — the page must server-render `type="email"`, `type="password"`, and must not contain "Continue with Google".

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/auth app/\(auth\)/sign-in tests/components/sign-in-form.test.tsx tests/integration/routes/sign-in.test.ts
git commit -m "feat: sign-in and create-account with resend, mapped errors, next-path landing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Forgot password and reset password

**Files:**
- Create: `app/(auth)/forgot-password/page.tsx`, `components/auth/forgot-password-form.tsx`, `app/(auth)/reset-password/page.tsx`, `components/auth/reset-password-form.tsx`
- Test: `tests/components/password-reset.test.tsx`

**Interfaces:**
- Consumes: `AuthCard`, `PasswordField`, `PasswordRequirements`, `AuthErrorAlert`; `requestPasswordReset`, `completePasswordReset`, `authErrorMessage`, `fieldErrorsFrom` (Task 3); `passwordSchema` from `@/lib/domain/auth`.
- Produces: `ForgotPasswordForm({})`; `ResetPasswordForm({ tokenHash }: { tokenHash?: string })`.

- [ ] **Step 1: Write the failing tests**

`tests/components/password-reset.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", assign })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe("ForgotPasswordForm", () => {
  it("confirms without revealing whether the account exists", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset").mockResolvedValue(undefined)
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(
      "If an account exists for a@example.test, a reset link is on its way."
    )
    expect(
      screen.queryByRole("button", { name: "Send reset link" })
    ).not.toBeInTheDocument()
  })

  it("tells the user when they are rate limited", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "x")
    )
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts."
    )
  })
})

describe("ResetPasswordForm", () => {
  it("offers a fresh link instead of a form when the token is missing", () => {
    render(<ResetPasswordForm />)
    expect(
      screen.queryByLabelText("New password")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toHaveAttribute("href", "/forgot-password")
  })

  it("updates the password and lands on /home", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockResolvedValue(undefined)
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/home"))
  })

  it("replaces the dead form with a recovery CTA when the token is rejected", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(400, "invalid_email_link", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That link is invalid or has expired."
    )
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toBeInTheDocument()
  })

  it("keeps the form for a non-terminal error", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts."
    )
    // The token may still be good, so the form stays — unlike the dead-token case.
    expect(screen.getByLabelText("New password")).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Request another link" })
    ).not.toBeInTheDocument()
  })

  it("rejects a locally-invalid password before contacting the server", async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(authApi, "completePasswordReset")
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correcthorse9x")
    await user.type(screen.getByLabelText("Confirm new password"), "correcthorse9x")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    // The requirements checklist also renders here, so the accessible
    // description concatenates both — match the error text, not the whole string.
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /Include at least one symbol\./
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/password-reset.test.tsx --project components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`components/auth/forgot-password-form.tsx` — client component; single `Field` email input (`type="email" autoComplete="email"`), submit button `Send reset link` (`Sending…` while pending, disabled). On success replace the form with a `role="status"` block reading exactly `If an account exists for {email}, a reset link is on its way.` plus a `Back to sign in` link to `/sign-in`. On error render `<AuthErrorAlert message={authErrorMessage(error)} />` and keep the form. Validate with `resetRequestSchema` before calling.

`components/auth/reset-password-form.tsx` — client component with three states:
- `tokenHash` absent → no form; explain the link is incomplete and render a `Request another link` **link** to `/forgot-password` plus `Back to sign in`.
- form state → two `PasswordField`s labelled `New password` (with `<PasswordRequirements value={password} />` as `describedBy`) and `Confirm new password`, both `autoComplete="new-password"`; local checks (`passwordSchema.safeParse`, then equality with message `Both passwords must match.`); submit `Update password` (`Updating…`, disabled); on success `window.location.assign("/home")` without clearing pending.
- dead-token state → entered when the caught error's code is `invalid_email_link` or `password_reset_failed`: hide the form and render `<AuthErrorAlert message={authErrorMessage(error)} />`, whose `request-reset-link` action supplies the `Request another link` link. Any other error keeps the form and applies `fieldErrorsFrom`.

`app/(auth)/forgot-password/page.tsx`:

```tsx
import { AuthCard } from "@/components/auth/auth-card"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata = { title: "Reset your password · NabaPresence" }

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="We will send a reset link if the email belongs to an account."
      footer={
        <a className="underline underline-offset-4" href="/sign-in">
          Back to sign in
        </a>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  )
}
```

`app/(auth)/reset-password/page.tsx` — same shape, title `Choose a new password`, reading `searchParams` for `token_hash` and passing it as `tokenHash` to the form.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/password-reset.test.tsx --project components`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/auth app/\(auth\) tests/components/password-reset.test.tsx
git commit -m "feat: forgot-password and reset-password with dead-token recovery

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Invitation acceptance

**Files:**
- Create: `components/auth/invitation-view.tsx`, `components/auth/invitation-actions.tsx`
- Modify: `app/invite/[token]/page.tsx` (recreate — it was deleted in M1)
- Test: `tests/components/invitation.test.tsx`

**Interfaces:**
- Consumes: `AuthCard`, `SignInForm`, `AuthErrorAlert`; `lookupInvitation`, `signOut`, `authErrorMessage` (Task 3); `QueryProvider`/`queryKeys` from `@/lib/queries`; `getSession` from `@/lib/server/session` (page only); `Skeleton`, `Button`, `Alert` primitives.
- Produces: `InvitationView({ token, viewer }: { token: string; viewer: { displayName: string; email: string } | null })`.

- [ ] **Step 1: Write the failing tests**

`tests/components/invitation.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/invite/tok", search: "", assign })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

function renderView(viewer: { displayName: string; email: string } | null = null) {
  return render(
    <QueryProvider>
      <InvitationView token="tok" viewer={viewer} />
    </QueryProvider>
  )
}

describe("InvitationView", () => {
  it("shows the create-account form for a signed-out visitor", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      accepted: false,
      expired: false,
    })
    renderView()
    expect(
      await screen.findByRole("heading", { level: 1, name: "Join Lapen Inns" })
    ).toBeInTheDocument()
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveValue("invited@example.test")
    expect(email).toHaveAttribute("readonly")
  })

  it("distinguishes an already-accepted invitation from an expired one", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      accepted: true,
      expired: false,
    })
    renderView()
    expect(
      await screen.findByText("You have already accepted this invitation.")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in"
    )
  })

  it("explains an expired invitation and offers a way out", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      accepted: false,
      expired: true,
    })
    renderView()
    expect(
      await screen.findByText("That invitation has expired.")
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument()
  })

  it("separates a missing invitation from a network failure", async () => {
    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(404, "invitation_not_found", "x")
    )
    const { unmount } = renderView()
    expect(
      await screen.findByText("We could not find that invitation.")
    ).toBeInTheDocument()
    unmount()

    vi.spyOn(authApi, "lookupInvitation").mockRejectedValue(
      new ApiClientError(500, "internal_error", "x")
    )
    renderView()
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("asks a signed-in visitor to sign out before continuing", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "lookupInvitation").mockResolvedValue({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      accepted: false,
      expired: false,
    })
    const signOutSpy = vi.spyOn(authApi, "signOut").mockResolvedValue(undefined)
    renderView({ displayName: "Aman Shrestha", email: "other@example.test" })
    expect(
      await screen.findByText(
        "You are signed in as other@example.test, but this invitation is for invited@example.test."
      )
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Sign out and continue" })
    )
    await waitFor(() => expect(signOutSpy).toHaveBeenCalled())
    expect(assign).toHaveBeenCalledWith("/invite/tok")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/invitation.test.tsx --project components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`components/auth/invitation-view.tsx` — client component using `useQuery({ queryKey: ["invitation", token], queryFn: () => lookupInvitation(token), retry: false })`:
- pending → `AuthCard` titled `Checking your invitation` with `Skeleton` rows.
- error, code `invitation_not_found` → mapped copy plus a `Go to sign in` link; any other error → `authErrorMessage(error)` copy plus a `Try again` button calling `refetch()` (this is the audit's separation of a missing invitation from a network failure).
- `data.accepted` → `You have already accepted this invitation.` + `Go to sign in` link.
- `data.expired` → `That invitation has expired.` + guidance to ask an owner or admin + `Go to sign in` link.
- ready + `viewer === null` → `AuthCard` titled `Join {organisationName}` containing `<SignInForm initialMode="create-account" inviteToken={token} invitedEmail={data.email} />`.
- ready + `viewer !== null` → `<InvitationActions viewer={viewer} invitedEmail={data.email} token={token} />`, no form.

`components/auth/invitation-actions.tsx` — renders the exact sentence the test pins when the addresses differ (`You are signed in as {viewer.email}, but this invitation is for {invitedEmail}.`) and, when they match, `You are signed in as {viewer.email}. Sign out and continue to accept this invitation.` Both render one `Sign out and continue` button that calls `signOut()` then `window.location.assign(`/invite/${token}`)` inside a `finally` so a failed sign-out still moves the user on.

`app/invite/[token]/page.tsx`:

```tsx
import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Accept invitation · NabaPresence" }

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await getSession()
  return (
    <QueryProvider>
      <InvitationView
        token={token}
        viewer={
          session
            ? { displayName: session.displayName, email: session.email }
            : null
        }
      />
    </QueryProvider>
  )
}
```

Note this page sits outside `(auth)`, so it needs its own centring wrapper — either move it under `app/(auth)/invite/[token]/page.tsx` (preferred: it inherits the auth layout, and the URL is unchanged because route groups do not affect paths) or repeat the layout classes. Choose the route-group move and say so in the report.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/invitation.test.tsx --project components`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/auth app/\(auth\)/invite tests/components/invitation.test.tsx
git commit -m "feat: invitation acceptance with accepted/expired/session states

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Sign-out, protected-route return path, and shell wiring

**Files:**
- Modify: `components/app-shell/app-shell.tsx` (sign-out control), `app/(dashboard)/layout.tsx` (redirect carries `?next=`)
- Test: `tests/components/app-shell.test.tsx` (extend)

**Interfaces:**
- Consumes: `signOut` from `@/lib/api/auth`; `sanitiseNextPath` (for the assertion only).
- Produces: the dashboard redirect contract `/sign-in?next=<pathname>` that Task 4's page already honours.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/app-shell.test.tsx`:

```tsx
describe("sign out", () => {
  it("clears the session then leaves the app", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const signOutSpy = vi
      .spyOn(await import("@/lib/api/auth"), "signOut")
      .mockResolvedValue(undefined)
    renderShell()
    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await waitFor(() => expect(signOutSpy).toHaveBeenCalled())
    expect(assign).toHaveBeenCalledWith("/sign-in")
  })

  it("still leaves the app when the sign-out request fails", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    vi.spyOn(await import("@/lib/api/auth"), "signOut").mockRejectedValue(
      new Error("offline")
    )
    renderShell()
    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"))
  })
})
```

Add `waitFor` and `userEvent` to the file's imports if they are not already there, and reuse its existing `renderShell()` helper.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/components/app-shell.test.tsx --project components`
Expected: FAIL — no `Sign out` control (M1 shipped the shell without one).

- [ ] **Step 3: Implement**

In `components/app-shell/app-shell.tsx`, add a `Sign out` button to the sidebar footer beside the identity block (reference `git show 4391dcb:components/naba-presence/app-shell.tsx` for placement and the `LogOut` icon). Its handler:

```tsx
async function handleSignOut() {
  try {
    await signOut()
  } finally {
    // Leave regardless: a failed clear is recoverable server-side, but a user
    // stuck on a dashboard they believe they have left is not.
    window.location.assign("/sign-in")
  }
}
```

Leave `app/(dashboard)/layout.tsx`'s redirect as the plain `redirect("/sign-in")` it already is. There is no middleware in this app, so a server component cannot read the requested pathname (`headers()` carries no `x-pathname` here) — inventing one would mean adding middleware, which is out of scope. The return path is already covered from the client: `handleUnauthorized` in `lib/api/client.ts` appends an encoded `?next=` built from `location.pathname + location.search`, and Task 4's page consumes it through `sanitiseNextPath`. Verify that end-to-end pairing by reading both files, and record in your report that the server-side redirect deliberately carries no `next` (a direct anonymous page load has no prior in-app location worth returning to).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/components/app-shell.test.tsx --project components`
Expected: PASS (all prior shell tests plus the two new ones).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add components/app-shell app/\(dashboard\)/layout.tsx tests/components/app-shell.test.tsx
git commit -m "feat: sign out from the shell with a guaranteed exit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Auth e2e and milestone gate

**Files:**
- Create: `tests/e2e/auth.spec.ts`
- Test: the full milestone gate

**Interfaces:**
- Consumes: every page from Tasks 4-6. Note the harness sets `PASSWORD_AUTH_ENABLED=false`, so real provider calls are impossible — mock `/api/auth/**` with `page.route()` to drive outcomes, exactly as the pre-rebuild accessibility suite did (`git show 4391dcb:tests/e2e/accessibility.spec.ts` for the pattern).

- [ ] **Step 1: Write the spec**

`tests/e2e/auth.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

const AUTH_PAGES = [
  { path: "/sign-in", heading: "Sign in to NabaPresence" },
  { path: "/forgot-password", heading: "Reset your password" },
  { path: "/reset-password", heading: "Choose a new password" },
]

test.describe("auth surfaces", () => {
  for (const page_ of AUTH_PAGES) {
    test(`${page_.path} renders one main and one h1`, async ({ page }) => {
      await page.goto(page_.path)
      await expect(
        page.getByRole("heading", { level: 1, name: page_.heading })
      ).toBeVisible()
      expect(await page.getByRole("main").count()).toBe(1)
    })
  }

  test("sign-in form is keyboard operable and password toggling works", async ({
    page,
  }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email address").fill("someone@example.test")
    await page.getByLabel("Password").fill("correct-horse-9")
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "password")
    await page.getByRole("button", { name: "Show password" }).click()
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "text")
  })

  test("an unconfirmed account is offered a resend", async ({ page }) => {
    await page.route("**/api/auth/password/login", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "email_not_verified",
          message: "Confirm your email address before signing in.",
        }),
      })
    })
    await page.goto("/sign-in")
    await page.getByLabel("Email address").fill("someone@example.test")
    await page.getByLabel("Password").fill("correct-horse-9")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toContainText(
      "Confirm your email address to continue."
    )
    await expect(
      page.getByRole("button", { name: "Resend confirmation email" })
    ).toBeVisible()
  })

  test("a confirmation-link failure explains itself on sign-in", async ({
    page,
  }) => {
    await page.goto("/sign-in?status=invitation_expired")
    await expect(page.getByRole("alert")).toContainText(
      "That invitation has expired."
    )
  })

  test("a reset page without a token offers a fresh link", async ({ page }) => {
    await page.goto("/reset-password")
    await expect(page.getByLabel("New password")).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Request another link" })
    ).toBeVisible()
  })

  test("an expired invitation is a dead end with an exit", async ({ page }) => {
    await page.route("**/api/invitations/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          organisationName: "Lapen Inns",
          email: "invited@example.test",
          accepted: false,
          expired: true,
        }),
      })
    })
    await page.goto("/invite/some-token")
    await expect(page.getByText("That invitation has expired.")).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean across auth pages (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      for (const target of [...AUTH_PAGES.map((p) => p.path), "/sign-in?mode=create-account"]) {
        await page.goto(target)
        await page.waitForLoadState("networkidle")
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        expect(wcag.violations, `${target} ${theme} wcag`).toEqual([])
        const best = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
          `${target} ${theme} structure`
        ).toEqual([])
      }
    })
  }
})
```

- [ ] **Step 2: Build, then run the spec**

```bash
pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test tests/e2e/auth.spec.ts
```

Expected: PASS. Fix any failure in the components, never by weakening an assertion. If a page needs the dashboard's session bootstrap to stay away (auth pages must not trigger it), confirm `(auth)` pages do not render `AppShell`.

- [ ] **Step 3: Run the full milestone gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/run-test-command.mjs e2e pnpm exec playwright test
node scripts/run-test-command.mjs integration pnpm exec vitest run tests/integration
```

Expected: unit + components green; e2e runs `foundation.spec.ts` AND `auth.spec.ts`, both green; integration exits 0 with only the two M4-marked skips remaining. Paste every summary line into the report.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/auth.spec.ts
git commit -m "test: auth e2e (pages, unhappy paths, axe in both themes)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone 2 exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green.
- `foundation.spec.ts` and `auth.spec.ts` green, including best-practice structural axe rules in light and dark.
- Integration suite exits 0; the M2-marked sign-in test is active again; only the two M4-marked skips remain.
- Every audit finding in M2's scope is closed: resend confirmation (J-5), status-specific confirm messages (J-5), invalid-reset-token recovery (J-5), accepted-vs-expired invitations (J-5), existing-session invite handling (J-11), rate-limit honesty (J-14), sign-out failure handling (J-14), `?next=` return, real `h1`s and labelled groups (H-2), show-password affordance, client-mirrored password policy (J-9 partial).
- No protected path changed beyond Task 2's four sanctioned edits.

