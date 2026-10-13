"use client"

import { KeyboardIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { SHORTCUTS_OPEN_EVENT } from "@/lib/inbox/events"

/**
 * The page header's way into the shortcut list (reference `shortcuts-button`).
 * The dialog itself belongs to InboxHotkeys, so this only asks for it.
 */
function ShortcutsButton() {
  // Desk only: the shortcuts are keyboard shortcuts, and a touch screen has
  // no keyboard to take them from. The span keeps the button its own width
  // where the toolbar lets its actions share a row.
  return (
    <span className="hidden desk:flex">
      <Button
        type="button"
        variant="ghost"
        aria-haspopup="dialog"
        onClick={() => window.dispatchEvent(new Event(SHORTCUTS_OPEN_EVENT))}
      >
        <KeyboardIcon aria-hidden data-icon="inline-start" />
        Shortcuts
        <Kbd aria-hidden>?</Kbd>
      </Button>
    </span>
  )
}

export { ShortcutsButton }
