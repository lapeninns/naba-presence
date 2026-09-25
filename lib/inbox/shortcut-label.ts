/**
 * The publish shortcut as this platform writes it. The publish bar shows it
 * beside Publish while there is text to save and check.
 */
export function saveShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+Enter"
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "⌘↵"
    : "Ctrl+Enter"
}
