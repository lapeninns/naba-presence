/**
 * Whether the Outbox destination (DIRECTION §7.1, decision D2) is shown.
 *
 * The destination is in the registry (lib/navigation/destinations.ts) and
 * its page is `app/(dashboard)/outbox`. While this is false every
 * navigation surface leaves Outbox out; true shows it to owners, admins and
 * members (never viewers).
 *
 * A route-existence guard rather than an organisation feature: Outbox is a
 * read of states every organisation already has, so there is nothing to
 * switch on per tenant.
 */
export const OUTBOX_ROUTE_READY = true
