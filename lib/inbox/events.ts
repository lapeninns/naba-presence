/** Dispatched after a reply successfully publishes; situation strip listens. */
export const PUBLISH_PULSE_EVENT = "inbox:reply-published"

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
