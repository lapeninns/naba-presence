/**
 * Whether the Outbox destination (DIRECTION §7.1, decision D2) is shown.
 *
 * The destination is in the registry (lib/navigation/destinations.ts) ahead
 * of its page: `app/(dashboard)/outbox` lands in a later change. Until it
 * does, a link would only lead to a 404, so every navigation surface leaves
 * Outbox out while this is false. The change that adds the route flips it in
 * the same commit; nothing else needs to change for Outbox to appear for
 * owners, admins and members (never viewers).
 *
 * A route-existence guard rather than an organisation feature: Outbox is a
 * read of states every organisation already has, so there is nothing to
 * switch on per tenant once the page exists.
 */
export const OUTBOX_ROUTE_READY = false
