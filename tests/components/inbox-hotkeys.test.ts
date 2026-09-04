import { describe, expect, it } from "vitest"

import { isTypingTarget, resolveAction, SHORTCUTS } from "@/lib/inbox/hotkeys"

const press = (key: string, modifiers: Record<string, boolean> = {}) =>
  resolveAction({ key, ...modifiers }, { isTyping: false })

describe("resolveAction", () => {
  it("maps the triage keys", () => {
    expect(press("j")).toBe("next")
    expect(press("k")).toBe("previous")
    expect(press("r")).toBe("reply")
    expect(press("a")).toBe("approve")
    expect(press("e")).toBe("assign")
    expect(press("Escape")).toBe("clear-selection")
    expect(press("?")).toBe("shortcuts")
  })

  it("separates selecting one row from extending a range", () => {
    expect(press("x")).toBe("toggle-selection")
    expect(press("x", { shiftKey: true })).toBe("extend-selection")
    expect(press("X")).toBe("extend-selection")
  })

  it("stays silent while someone is typing", () => {
    // `a` in the middle of a reply must not publish it — the worst thing a
    // shortcut layer can do in an app whose main job is writing text.
    for (const key of ["a", "j", "r", "x", "?"]) {
      expect(resolveAction({ key }, { isTyping: true })).toBeNull()
    }
  })

  it("lets the command palette through even mid-sentence", () => {
    expect(resolveAction({ key: "k", metaKey: true }, { isTyping: true })).toBe("command")
    expect(resolveAction({ key: "k", ctrlKey: true }, { isTyping: true })).toBe("command")
  })

  it("ignores browser and system chords", () => {
    // Cmd+R is reload, Alt+J is a system binding; neither belongs to us.
    expect(press("r", { metaKey: true })).toBeNull()
    expect(press("j", { altKey: true })).toBeNull()
  })

  it("has a documented shortcut for every action it resolves", () => {
    const documented = new Set(SHORTCUTS.map((shortcut) => shortcut.action))
    for (const key of ["j", "k", "r", "a", "e", "x", "Escape", "?"]) {
      const action = press(key)
      expect(action).not.toBeNull()
      expect(documented.has(action!)).toBe(true)
    }
  })
})

describe("isTypingTarget", () => {
  it("recognises the places a letter should be typed", () => {
    const input = document.createElement("input")
    const textarea = document.createElement("textarea")
    const div = document.createElement("div")
    document.body.append(input, textarea, div)
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(textarea)).toBe(true)
    expect(isTypingTarget(div)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    input.remove()
    textarea.remove()
    div.remove()
  })

  it("does not mistake the document for a text field", () => {
    // The listener sits on `document`, so with nothing focused the keydown
    // target IS the document. Reporting that as "typing" swallowed every
    // shortcut in the inbox, silently, depending on what had focus.
    expect(isTypingTarget(document)).toBe(false)
    expect(isTypingTarget(window)).toBe(false)
  })

  it("stands off dialogs and menus, which drive their own keys", () => {
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    const button = document.createElement("button")
    dialog.append(button)
    document.body.append(dialog)
    expect(isTypingTarget(button)).toBe(true)
    dialog.remove()
  })
})
