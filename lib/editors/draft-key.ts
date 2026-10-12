/**
 * What a stashed draft belongs to. A stash is offered back only to the same
 * person, in the same organisation, editing the same resource, in the same
 * draft shape: a key that differs in any part is a different draft.
 *
 * - `resource`: the editor ("location-hours", "inbox-reply", ...).
 * - `resourceId`: the thing edited (a location, review, post or client id),
 *   or omitted for an organisation-wide form.
 * - `schemaVersion`: bump it whenever the stashed JSON changes shape, so an
 *   old stash is ignored instead of parsed into the new form.
 */
export type DraftScope = {
  resource: string
  resourceId?: string | null
  schemaVersion: number
}

export type DraftIdentity = {
  userId: string | null
  organisationId: string | null
}

// The identity segment for a draft written before the session was known
// (a bare component test, the anonymous bootstrap). It can never match a
// signed-in identity, so `purgeForeignDrafts` removes it once one is known.
const UNKNOWN = "-"

function segment(value: string | null | undefined): string {
  return value ? encodeURIComponent(value) : UNKNOWN
}

/**
 * The part of every draft key that names who wrote it. `purgeForeignDrafts`
 * keeps exactly the stashes under this prefix.
 */
export function draftIdentityPrefix(identity: DraftIdentity): string {
  return `u:${segment(identity.userId)}:o:${segment(identity.organisationId)}:`
}

/**
 * The stash key for one draft. Every segment is URI-encoded, so an id that
 * contains the separator cannot make one key read as another's.
 */
export function draftKey({
  userId,
  organisationId,
  resource,
  resourceId,
  schemaVersion,
}: DraftIdentity & DraftScope): string {
  return (
    draftIdentityPrefix({ userId, organisationId }) +
    `r:${encodeURIComponent(resource)}:${segment(resourceId)}:v${schemaVersion}`
  )
}

const IDENTITY_PREFIX = /^u:([^:]*):o:([^:]*):/

/**
 * Who a draft key belongs to: its `draftIdentityPrefix` when it names a
 * signed-in user and organisation, or null for a key written before the
 * session was known (or one not built by `draftKey`). Segments are
 * URI-encoded, so a `:` inside an id cannot shift the match.
 */
export function draftKeyOwner(key: string): string | null {
  const match = IDENTITY_PREFIX.exec(key)
  if (!match || match[1] === UNKNOWN || match[2] === UNKNOWN) return null
  return match[0]
}
