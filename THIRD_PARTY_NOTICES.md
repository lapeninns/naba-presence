# Third-party notices

NabaPresence includes code adapted from the projects below. Runtime and
development dependencies installed from npm carry their own licences in
`node_modules` and are not repeated here.

## OpenGMB

Source: <https://github.com/synectus/OpenGMB> (commit `4241b6bb`, read 2026-10-30).
OpenGMB is a trademark of its owner. NabaPresence does not use the name in its
product.

Adapted files, each marked at the top:

- `lib/listings/completeness.ts`: from `packages/core/src/healthcheck/evaluate.ts`
  and `packages/core/src/config/healthcheck.ts` (check list, importance levels,
  thresholds, score rule).
- `lib/listings/completeness-text.ts`: from `packages/core/src/healthcheck/similarity.ts`
  (description problems, bigram Dice similarity).
- `lib/domain/review-link.ts`: from `packages/core/src/review-links/pure.ts`
  (`isLikelyBot`, click sources).
- `lib/domain/review-link-caption.ts`: from `packages/core/src/review-requests/pure.ts`
  (`gatingProblem`) and `packages/core/src/guardrails/review-request/gating.ts`
  (`GATING_RULES`).
- `lib/domain/review-link-qr.ts`: from `packages/core/src/review-links/qr.ts` (`qrSvg`).
- `lib/domain/review-topics.ts`: from `packages/core/src/reviews/topics.ts`
  (review text as data, dropping malformed items).
- `lib/domain/review-topics-trends.ts`: from `packages/core/src/reviews/topic-trends.ts`
  (Monday-UTC week bucketing).
- `lib/server/review-rating-alerts.ts`: from `packages/core/src/reviews/negative-alert.ts`
  (`isNegativeChange`).

```text
MIT License

Copyright (c) 2026 Synectus Private Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
