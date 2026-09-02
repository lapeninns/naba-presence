/** Dispatched after a reply successfully publishes; situation strip listens. */
export const PUBLISH_PULSE_EVENT = "inbox:reply-published"

/**
 * How long the situation strip shows its success ring after a publish. The
 * inbox view waits this long before advancing to the next review, so the
 * pulse is actually on screen before the detail pane (keyed on the selected
 * id) unmounts it.
 */
export const PUBLISH_PULSE_MS = 1600
