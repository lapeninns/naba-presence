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
  // The span keeps the button its own width where the toolbar lets its
  // actions share a row. Phones have no keyboard to take shortcuts from.
  return (
    <span className="flex max-md:hidden">
      <Button
        type="button"
        variant="ghost"
        size="sm"
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
