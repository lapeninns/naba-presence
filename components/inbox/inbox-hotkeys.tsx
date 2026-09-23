"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { SHORTCUTS_OPEN_EVENT } from "@/lib/inbox/events"
import { isTypingTarget, resolveAction, SHORTCUTS } from "@/lib/inbox/hotkeys"

export type HotkeyHandlers = Partial<
  Record<
    | "next"
    | "previous"
    | "reply"
    | "approve"
    | "assign"
    | "toggle-selection"
    | "extend-selection"
    | "clear-selection",
    () => void
  >
>

/**
 * Binds the inbox's keyboard vocabulary.
 *
 * The listener is on the document rather than a focused element: an operator
 * working a backlog keeps focus in the list while their attention is on the
 * detail pane, and requiring focus in the right place first would make the
 * shortcuts feel broken. `isTypingTarget` is what keeps that safe — without
 * it, `a` in the middle of a reply would publish it.
 */
function InboxHotkeys({ handlers }: { handlers: HotkeyHandlers }) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const handlersRef = React.useRef(handlers)
  React.useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = resolveAction(event, {
        isTyping: isTypingTarget(event.target),
      })
      if (!action) return
      if (action === "command") return // The shell owns ⌘K.
      if (action === "shortcuts") {
        event.preventDefault()
        setSheetOpen((open) => !open)
        return
      }
      const handler = handlersRef.current[action]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    function onOpen() {
      setSheetOpen(true)
    }
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener(SHORTCUTS_OPEN_EVENT, onOpen)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener(SHORTCUTS_OPEN_EVENT, onOpen)
    }
  }, [])

  return (
    <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            These work anywhere in the inbox, except while you are typing, so a
            reply is never sent by accident.
          </DialogDescription>
        </DialogHeader>
        {/* Reference `.dl`: the keys in a narrow first column, what they do
            beside them. */}
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 pb-1">
          {SHORTCUTS.filter(
            // Only keys that do something here: `a` and `e` have no binding
            // in the inbox yet, and a listed key that does nothing reads as
            // broken. `?` and ⌘K are owned by this dialog and the shell.
            (shortcut) =>
              shortcut.action === "shortcuts" ||
              shortcut.action === "command" ||
              shortcut.action in handlers
          ).map((shortcut) => (
            <React.Fragment key={shortcut.action}>
              <dt className="flex gap-1">
                {shortcut.keys.split(" ").map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd className="text-ui text-ink">{shortcut.label}</dd>
            </React.Fragment>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

export { InboxHotkeys }
