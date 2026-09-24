/**
 * The inbox's keyboard vocabulary.
 *
 * Pure: a key event in, an action name out. The component that owns the
 * actions binds them, which keeps the mapping testable without rendering a
 * list and makes the shortcut sheet and the handler read from one source.
 */
export type InboxAction =
  | "next"
  | "previous"
  | "reply"
  | "search"
  | "approve"
  | "assign"
  | "toggle-selection"
  | "extend-selection"
  | "clear-selection"
  | "shortcuts"
  | "command"

export type KeyLike = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

export const SHORTCUTS: { keys: string; action: InboxAction; label: string }[] = [
  { keys: "j", action: "next", label: "Next review" },
  { keys: "k", action: "previous", label: "Previous review" },
  { keys: "r", action: "reply", label: "Write a reply" },
  { keys: "/", action: "search", label: "Search reviews" },
  { keys: "a", action: "approve", label: "Approve and publish" },
  { keys: "e", action: "assign", label: "Assign to a colleague" },
  { keys: "x", action: "toggle-selection", label: "Select this review" },
  { keys: "Shift X", action: "extend-selection", label: "Select through here" },
  { keys: "Esc", action: "clear-selection", label: "Clear the selection" },
  { keys: "?", action: "shortcuts", label: "Show these shortcuts" },
  { keys: "⌘K", action: "command", label: "Search everything" },
]

/**
 * True when the event target is somewhere a letter should be typed, not
 * interpreted. Without this, `a` in the middle of a reply would try to publish
 * it — the single worst thing a shortcut layer can do in an app whose main job
 * is writing text.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  // The listener sits on `document`, so the target is not always an element:
  // with nothing focused a keydown can target the document itself. Guarding on
  // `closest` rather than on truthiness matters, because `element.closest?.(…)`
  // on a non-element evaluates to `undefined`, and `undefined !== null` is
  // true — which used to report "they are typing" and swallow every shortcut.
  if (!element || typeof element.closest !== "function") return false
  const tag = element.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true ||
    // A listbox or menu is driving its own arrow keys and letters.
    element.getAttribute?.("role") === "listbox" ||
    element.closest("[role='dialog'],[role='menu'],[role='listbox']") !== null
  )
}

/**
 * Resolves a key event to an action, or null.
 *
 * `⌘K` is the one binding that survives inside a text field: it opens a
 * search, which is what a person pressing it mid-sentence wants.
 */
export function resolveAction(
  event: KeyLike,
  options: { isTyping: boolean }
): InboxAction | null {
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === "k") return "command"
  if (options.isTyping) return null
  if (mod || event.altKey) return null

  switch (event.key) {
    case "j":
      return "next"
    case "k":
      return "previous"
    case "r":
      return "reply"
    case "/":
      return "search"
    case "a":
      return "approve"
    case "e":
      return "assign"
    case "x":
      return event.shiftKey ? "extend-selection" : "toggle-selection"
    case "X":
      return "extend-selection"
    case "Escape":
      return "clear-selection"
    case "?":
      return "shortcuts"
    default:
      return null
  }
}
