"use client"

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

/**
 * Local editable state seeded from a server value, reset only when that
 * value's revision advances.
 *
 * Why not `useEffect(() => setValue(initial), [initial])`: react-hooks/
 * set-state-in-effect flags an effect whose body is a bare synchronous
 * setState, and it would also clobber in-progress edits on every incidental
 * re-render that produces a new `initial` object (memo misses, refetch with
 * identical content). Guarding on the revision — the canonical resource
 * revision, a Google hash, or any other "the server value really changed"
 * token — means local edits survive until a successful save/publish
 * invalidates, refetches and moves the revision forward.
 *
 * Replaces the per-tab `useState` + `useRef` + `useEffect` guard that was
 * copy-pasted across the location tabs.
 *
 * @param initial  the server value to seed from (and reset to)
 * @param revision the token that identifies which server value `initial` is
 */
export function useResetOnRevision<T>(
  initial: T,
  revision: unknown
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial)
  const revisionRef = useRef(revision)
  useEffect(() => {
    if (Object.is(revisionRef.current, revision)) return
    revisionRef.current = revision
    setValue(initial)
  }, [initial, revision])
  return [value, setValue]
}
