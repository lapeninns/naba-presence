"use client"

import * as React from "react"

type SelectionValue = {
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  extendTo: (id: string, orderedIds: string[]) => void
  replace: (ids: string[]) => void
  clear: () => void
  /**
   * Touch only: the list is in select mode, so its checkboxes show and a
   * tap on a row ticks it instead of opening it. On a desk the checkboxes
   * are always there and this changes nothing visible.
   */
  selectMode: boolean
  setSelectMode: (on: boolean) => void
}

const SelectionContext = React.createContext<SelectionValue | null>(null)

/**
 * Which reviews are ticked for a bulk action, and whether a touch list is
 * in select mode.
 *
 * Kept out of the URL deliberately: a selection is a momentary working set,
 * not a place. Putting it in the address bar would fill the history with
 * every tick and make "share this view" mean "share my half-finished batch".
 *
 * Select mode rules:
 * - `setSelectMode(false)` ("Done") also clears the selection: leaving the
 *   mode with rows still ticked would leave a bulk bar for rows the
 *   operator can no longer see ticked.
 * - `toggle(id)` that ticks a row turns select mode on, so a selection made
 *   any other way (a hotkey, a desk click) is never invisible on touch.
 * - `clear()` leaves select mode as it is: Esc and "Clear" empty the
 *   working set without throwing the operator out of the mode they chose.
 * - `replace` and `extendTo` do not change the mode; they come from the
 *   select-all box and Shift ranges, which only exist where boxes show.
 */
function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [selectMode, setSelectModeState] = React.useState(false)
  // The row a range extends FROM. Shift-click without one selects a single row
  // rather than guessing at an anchor.
  const anchor = React.useRef<string | null>(null)

  const value = React.useMemo<SelectionValue>(
    () => ({
      selected,
      selectMode,
      setSelectMode(on) {
        setSelectModeState(on)
        if (!on) {
          anchor.current = null
          setSelected(new Set())
        }
      },
      toggle(id) {
        anchor.current = id
        if (!selected.has(id)) setSelectModeState(true)
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      },
      extendTo(id, orderedIds) {
        const from = anchor.current
        if (!from) {
          anchor.current = id
          setSelected((current) => new Set(current).add(id))
          return
        }
        const start = orderedIds.indexOf(from)
        const end = orderedIds.indexOf(id)
        if (start === -1 || end === -1) return
        const [low, high] = start < end ? [start, end] : [end, start]
        setSelected((current) => {
          const next = new Set(current)
          for (const rangeId of orderedIds.slice(low, high + 1))
            next.add(rangeId)
          return next
        })
      },
      replace(ids) {
        setSelected(new Set(ids))
      },
      clear() {
        anchor.current = null
        setSelected(new Set())
      },
    }),
    [selected, selectMode]
  )

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  )
}

function useSelection(): SelectionValue {
  const context = React.useContext(SelectionContext)
  if (!context) {
    throw new Error("useSelection must be used inside a SelectionProvider")
  }
  return context
}

export { SelectionProvider, useSelection }
