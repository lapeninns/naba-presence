"use client"

import * as React from "react"

/** How long typing must pause before the search is written to the address. */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * A search field's text, kept locally and written to the address once typing
 * pauses, so a keystroke never waits on navigation and history does not get
 * one replace per letter.
 *
 * - `draft` is what the field shows; `setDraft` is its onChange.
 * - `flush()` writes the draft now (Enter, blur, an explicit clear).
 * - A Back/Forward that changes the address value wins: the draft follows it,
 *   and any pending write is dropped. The value this hook wrote itself
 *   arriving later does not reset the draft, so letters typed while the
 *   navigation was in flight are kept.
 */
export function useDebouncedSearchParam(
  urlValue: string,
  write: (next: string) => void,
  delay = SEARCH_DEBOUNCE_MS
) {
  const [draft, setDraftState] = React.useState(urlValue)
  // The address value last seen, and the value this hook last wrote. Both
  // are state, adjusted during render (react.dev "you might not need an
  // effect"), so the comparison never reads a ref while rendering.
  const [seen, setSeen] = React.useState(urlValue)
  const [written, setWritten] = React.useState(urlValue)
  if (urlValue !== seen) {
    setSeen(urlValue)
    setWritten(urlValue)
    if (urlValue !== written) setDraftState(urlValue)
  }

  const onWrite = React.useEffectEvent((next: string) => {
    setWritten(next)
    write(next)
  })

  React.useEffect(() => {
    if (draft === written) return
    const timer = setTimeout(() => onWrite(draft), delay)
    return () => clearTimeout(timer)
  }, [draft, written, delay])

  const flush = () => {
    if (draft === written) return
    setWritten(draft)
    write(draft)
  }

  /**
   * The draft, marked as written, for a caller that puts it in the address
   * as part of a larger change (a health filter), so the two never race.
   */
  const take = () => {
    setWritten(draft)
    return draft
  }

  /** Empties the field for a caller that clears `?q=` itself. */
  const clear = () => {
    setDraftState("")
    setWritten("")
  }

  return { draft, setDraft: setDraftState, flush, take, clear }
}
