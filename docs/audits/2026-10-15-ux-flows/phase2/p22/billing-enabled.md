# P22 · Billing page with billing on (D11)

P22 (#144) fixed the paint time of `/settings/billing` with billing **off**: LCP went from 3,376ms to 1,252ms on a throttled phone. Measuring the page with billing **on** waited for decision D11. This is that measurement.

**Result: every budget is met, so no product change is needed.**

## How it was measured

- **Build:** a production build of `main` @ `21f9891b` (`pnpm build`, then `pnpm start`).
- **Data:** the `visual-fixtures` tenant ("Sprint 5 Journey tenant"), signed in as its owner. Fixture data only.
- **Billing on:** `BILLING_ENABLED=true` was set on the app process only, as `tests/visual/nm-serve.mjs` does. No env file changed.
- **No Stripe key:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PORTAL_CONFIGURATION_ID` were set empty on that process. The env schema reads an empty value as unset, and `@next/env` never overrides a variable that is already set.
- **What the page shows:** the fixture tenant is on Pilot access, so the page shows the Subscription card and "Subscriptions are not available yet. Nothing has been charged." No request reached Stripe.
- **Commands:**
  - `node tests/perf/perf-lab.mjs --profile mobile --runs 3 --routes /settings/billing,/settings --budgets tests/perf/budgets-baseline.json`
  - the same with `--profile desktop --runs 2`
  - Both ended with "All budgets met."
- **Control route:** `/settings`, measured in the same session.

## Mobile (390×844, 4× CPU, Slow 4G, 3 cold runs, medians)

| Route                                            |     FCP |         LCP |   CLS |   TBT | Longest task | First-load JS (xfer) | Lazy JS | Requests | Total | DOM nodes |
| ------------------------------------------------ | ------: | ----------: | ----: | ----: | -----------: | -------------------: | ------: | -------: | ----: | --------: |
| `/settings/billing` (on)                         | 1,216ms | **1,216ms** | 0.000 |  51ms |         86ms |                460KB |     6KB |       64 | 545KB |       282 |
| `/settings` (control)                            | 1,220ms |     1,220ms | 0.000 |  67ms |         86ms |                505KB |     6KB |       84 | 599KB |       347 |
| Budget (`budgets-baseline.json`, mobile default) |       – |     1,500ms |   0.1 | 200ms |        200ms |                520KB |    60KB |        – | 820KB |     1,200 |

Per run, `/settings/billing` LCP was 1,212, 1,228 and 1,216ms.

## Desktop (1280×800, unthrottled, 2 cold runs, medians)

| Route                    |  LCP |   CLS | TBT | First-load JS (xfer) | Requests | Total | DOM nodes |
| ------------------------ | ---: | ----: | --: | -------------------: | -------: | ----: | --------: |
| `/settings/billing` (on) | 90ms | 0.000 | 0ms |                460KB |       75 | 545KB |       278 |
| `/settings` (control)    | 90ms | 0.000 | 0ms |                505KB |       82 | 596KB |       316 |

## Reading it

- With billing on, `/settings/billing` paints as fast as the other settings routes. Mobile LCP is 1,216ms, against 1,252ms for the disabled 404 after P22 and 1,220ms for `/settings`.
- **Headroom:** about 280ms of LCP and 60KB of first-load JS on mobile. It also loads 45KB less JS than `/settings`.
- **INP probe on mobile: not measured.** Its control on this route, a link to `/settings/usage`, isn't on the phone page while the fixture tenant is on Pilot, so perf-lab recorded none. On desktop, where the link is present, the probe tap took 16ms.
- **Not covered:** a tenant with a live Stripe subscription (invoices, payment method). That needs Stripe data, which D11 rules out.

## Files

- `billing-enabled-perf-mobile.json` and `billing-enabled-perf-desktop.json`: raw perf-lab output.
- `billing-enabled-390-light.jpg`, `billing-enabled-390-dark.jpg` and `billing-enabled-1280-light.jpg`: the page as measured.
