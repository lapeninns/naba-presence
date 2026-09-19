# GBP Local Posts — design

Date: 2026-07-31
Status: approved for implementation

## Goal

Manage Google Business Profile standard updates, events, and offers from
NabaPresence with local drafts, permission-aware approval, durable mutation
intent, provider settlement, readback, reconciliation, and deletion.

Product posts are excluded because Google does not expose API creation for
that post type. Scheduled and recurring publishing are represented explicitly
and remain gated until their provider behavior has been verified against the
connected account.

## Lifecycle

`draft → awaiting_approval → publishing → published`, with `failed`,
`ambiguous`, and `deleted` terminal/recovery states. Every Google mutation is
persisted before the call, executed outside a database transaction, then
settled with the provider resource name and response payload. Unknown provider
fields are retained only in the bounded raw provider snapshot.

## API and UI

- List/create: `/api/locations/:locationId/posts`
- Read/update/delete: `/api/locations/:locationId/posts/:postId`
- Publish/request approval: `.../:postId/publish`
- Approve/reject: `.../:postId/approval`

The location Posts tab provides a type-aware composer, draft/published list,
status and error states, edit, publish/request-approval, approve/reject, and
delete controls. Provider writes require `GBP_POSTS_ENABLED`, the global
publish flag, location publish permission, and a live Google link.

