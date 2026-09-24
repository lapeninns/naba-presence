/**
 * The save shortcut as this platform writes it. The composer's hint and the
 * publish bar's "Save & check" both show it, so they read from one place.
 */
export function saveShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+Enter"
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "⌘↵"
    : "Ctrl+Enter"
}
