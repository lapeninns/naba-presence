# OpenGMB gap features

Written 2026-10-30. This records what shipped from the top five items of
[the OpenGMB feature gap](../research/2026-10-30-opengmb-feature-gap.md). The
features were built as five parallel streams and integrated on
`feat/opengmb-gap-features`. None needs a new OAuth scope or Google API
family: everything uses `business.manage` and data NabaPresence already stores.

## What shipped

### 1. Listing completeness score

- Each listing gets a score from deterministic checks in three importance
  levels (necessary, important, nice). Each check has a plain finding and a
  link to the listing area that fixes it (`lib/listings/completeness.ts`).
- The score is database-only and never calls Google. A check whose data is
  missing or stale is `unknown`, and unknown never counts as a fail. A listing
  shows no score until at least half its weighted checks have data.
- It shows as a Completeness column on `/listings` (sortable by "most to fix")
  and as a card on the listing overview.
- Owners and admins can skip a check per listing with a reason. Skips are
  audited and stored in `listing_completeness_skip`. Members see the score
  read-only.
- "Unreplied for over a week" uses the inbox's needs-reply definition.

### 2. Review links and QR codes

- Each listing has a short link, `/r/<code>`, that records a click and
  redirects (302) to Google's `newReviewUri` from the stored snapshot. The URL
  is never built by hand. Codes are random, can be rotated or disabled, and an
  unknown or disabled code shows a neutral page with no venue data. The
  redirect is rate-limited.
- Clicks store only a timestamp and a source (`qr` or `link`): no IP address,
  user agent or guest data. They are kept for the life of the link.
- The new listing area "Review link" has copy, a QR preview, PNG and SVG
  downloads, rotate and disable, and a 30/90-day chart of clicks against new
  reviews.
- Printed captions are checked for review gating (no star asks, no "how was
  your visit", no incentives).
- QR codes are drawn with `uqr@0.1.3` (MIT, no dependencies).
- Disconnecting Google doesn't disable a link: printed codes keep working.

### 3. Review topics and trends

- Reviews with text are classified into a fixed hospitality topic list, with
  a sentiment per topic. Classification runs as a job on the existing tick,
  under the AI credit ledger, kill switch and `drafts` pause scope. Reviewer
  names are never sent. Malformed model output is rejected, not stored.
- Reports gets a "What guests talk about" panel (topic share, negative share,
  an 8-week trend, CSV export). The inbox gets a Topic filter.
- A `review_topic_negative` alert fires when a listing's negative share for a
  topic over 14 days is well above its own 90-day baseline (at least 3
  negative reviews; 7-day cooldown).
- **The `review_topics` organisation feature ships OFF everywhere.**
  Classification sends review text to OpenAI without a draft request, so it
  stays off until the privacy notice covers it. Topic labels hold no review
  text, are kept for the life of their review, and are deleted with it,
  including on privacy erasure (admitted under D-28).
- Bug fix, live for everyone: `low_rating_review` now fires when an existing
  review is edited from 4–5★ down to ≤3★, through both sync and Pub/Sub.

### 4. Content checks and reply repetition

- Replies: a warning when the opening sentence matches a recent published
  reply for the same client, and a fail when the whole reply is a near
  duplicate of one of the last 30. Rating-only template replies are exempt.
- Posts and profile descriptions: phone numbers and URLs in the body, Google
  length limits, ALL-CAPS and excessive punctuation, expired dates in offer
  posts, and banned phrases. The checks run on save and again just before
  publish. A fail blocks; a warning needs explicit acknowledgement, which
  carries through bulk and recurring posts and is re-asked when the text or
  the warnings change.
- Owners and admins manage an organisation-wide banned-phrase list in Reply
  policy settings. It applies to replies, posts and descriptions.

### 5. Google change watch

- When a protected field (name, phone, website, regular hours, special hours,
  primary category, description) changes on Google and differs from our last
  published value, the listing's watch recipients get a
  `listing_google_changed` notification, deduplicated per field and value.
  Detection reuses existing sync and observation data and ignores our own
  publishes.
- The Suggestions tab shows "Ours vs Google's" with two actions:
  - **Put ours back** builds a normal change set, bound to the observed
    Google baseline, through the existing approval and publish path. Nothing
    reverts automatically.
  - **Accept Google's** moves our baseline without writing to Google. It is
    for owners and admins only, is audited, and needs no second approver.
- Per-listing settings choose the protected fields and who is alerted.

## Migrations

All are expand-only, and each records its own `schema_migration` row.

| Version                               | Purpose                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `0150_content_banned_phrases`         | Organisation banned-phrase list                                             |
| `0151_listing_completeness_skip`      | Per-listing completeness skips                                              |
| `0152_review_link`                    | `review_link`, `review_link_click`                                          |
| `0153_review_topics`                  | `review_topic`, `review_topic_classification`, org feature                  |
| `0154_review_topic_notification_kind` | `review_topic_negative` notification kind                                   |
| `0155_listing_google_watch`           | Watch settings, recipients, detected changes, `listing_google_changed` kind |

`0155` re-lists the notification kind check and keeps `0154`'s kind.

## Not built

- Rank grids and MCP/API tokens were design-only tracks. Their recommendations
  are recorded with the fan-out reports, and neither is built.
- Email review-request campaigns, which need guest-email consent and a sending
  domain.

Third-party attribution is in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
