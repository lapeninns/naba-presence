/**
 * Dispatched after a publish or approval the server accepted: `published`, or
 * `pending` when Google has the reply and has not confirmed it yet. The status
 * strip pulses and the inbox moves on to the next review.
 */
export const PUBLISH_PULSE_EVENT = "inbox:reply-published"

export type PublishPulseDetail = {
  reviewId: string
  status?: "published" | "pending"
}

/** The outcomes that finish this review's work and so move the inbox on. */
export function isAdvancingOutcome(
  status: string
): status is "published" | "pending" {
  return status === "published" || status === "pending"
}

/**
 * Asks the open composer to generate a draft in the default tone — what `g`
 * does. Like `r`, the composer decides whether that is allowed.
 */
export const REPLY_GENERATE_EVENT = "inbox:generate-reply"

/**
 * Asks the publish bar to press its primary action — what `a` does. The bar
 * applies every gate it applies to a click; the hotkey only asks.
 */
export const PRIMARY_ACTION_EVENT = "inbox:primary-action"

/**
 * How long the situation strip shows its success ring after a publish. The
 * inbox view waits this long before advancing to the next review, so the
 * pulse is actually on screen before the detail pane (keyed on the selected
 * id) unmounts it.
 */
export const PUBLISH_PULSE_MS = 1600

/**
 * Asks the selected review's composer to open and take focus — what `r` does.
 *
 * An event rather than a ref threaded down from InboxView: the composer is
 * mounted by ReviewDetail (in the inspector column or the mobile sheet, never
 * both) and knows on its own whether editing is permitted. The hotkey layer
 * must not decide that; it only asks.
 */
export const REPLY_FOCUS_EVENT = "inbox:focus-reply"

/**
 * Opens the keyboard-shortcuts dialog — what `?` does, and what the page
 * header's Shortcuts button asks for. The header is rendered by the server
 * page, outside the client tree that owns the dialog, so it asks by event.
 */
export const SHORTCUTS_OPEN_EVENT = "inbox:open-shortcuts"

/**
 * Puts the caret in the review search — what `/` does. On a phone the field
 * is folded behind an icon, so the toolbar unfolds it first.
 */
export const SEARCH_FOCUS_EVENT = "inbox:focus-search"
