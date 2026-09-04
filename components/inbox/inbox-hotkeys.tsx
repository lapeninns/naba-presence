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
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            These work anywhere in the inbox, except while you are typing.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1.5">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.action}
              className="flex items-center justify-between gap-4 text-ui"
            >
              <span>{shortcut.label}</span>
              <span className="flex gap-1">
                {shortcut.keys.split(" ").map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export { InboxHotkeys }
