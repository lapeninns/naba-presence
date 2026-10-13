"use client"

import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { peekStashedDraft } from "@/lib/api/draft-stash"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { useHydrated } from "@/lib/hooks/use-hydrated"

import { draftKeyOwner, type DraftScope } from "./draft-key"
import { useDraftKey } from "./use-draft-key"

export type EditorDraft<T> = {
  draft: T
  setDraft: Dispatch<SetStateAction<T>>
  isDirty: boolean
  /** Throw the local edits away and go back to what the server holds. */
  discard: () => void
  /** Ask before losing edits; resolves true when it is safe to continue. */
  confirmDiscard: () => Promise<boolean>
  /**
   * The operator agreed to lose these edits some other way (the leave
   * prompt): don't stash them when the editor unmounts.
   */
  forget: () => void
  /**
   * Call just before this editor saves or publishes: the revision change
   * that follows is our own, so the draft follows it without asking.
   */
  expectSave: () => void
  /**
   * Someone else saved a newer version while this draft had unsaved edits.
   * The edits are kept; the operator picks with `loadIncoming` / `keepMine`.
   */
  incoming: boolean
  loadIncoming: () => void
  keepMine: () => void
  /**
   * Edits left behind when this editor was last unmounted without saving
   * (navigating back, a forced sign-out). Offered, never applied silently.
   */
  stashed: boolean
  restoreStashed: () => void
  dismissStashed: () => void
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function missing(revision: unknown): boolean {
  return revision === null || revision === undefined
}

/**
 * The things every Google-writing editor did by hand: seed a draft from the
 * server value, follow that value when its revision moves, and arm the dirty
 * guard so a reload or a forced sign-out doesn't eat the work.
 *
 * When the revision moves while the draft holds unsaved edits (a colleague
 * saved in another tab), the edits are NOT overwritten: `incoming` turns on
 * and the editor offers "Load theirs" / "Keep mine". A revision change this
 * editor caused (`expectSave`), or one that arrives while the draft is clean
 * or already equal to the new value, is followed silently. A revision that
 * goes from missing to present is the first real seed (Google's half of the
 * profile loading), not someone else's change.
 *
 * Comparison is by JSON shape, which is what the tabs already used. It is
 * exact enough for these draft objects (plain data, stable key order from the
 * same schema) and avoids every editor writing its own equality.
 */
export function useEditorDraft<T>({
  initial,
  revision,
  scope,
  parseStashed,
  isEqual = same,
}: {
  initial: T
  /** Token that changes when the SERVER value changes — usually a revision. */
  revision: unknown
  /**
   * What the stash belongs to. The key adds the signed-in user and
   * organisation (lib/editors/draft-key.ts), so a stash is only ever offered
   * back to whoever wrote it, and a `schemaVersion` bump ignores old ones.
   */
  scope: DraftScope
  parseStashed?: (value: unknown) => T | null
  /**
   * When two drafts count as the same edits. Defaults to the JSON shape; an
   * editor whose untouched form isn't byte-equal to its seed (a new post's
   * type picker, whitespace-only text) passes its own.
   */
  isEqual?: (a: T, b: T) => boolean
}): EditorDraft<T> {
  const key = useDraftKey(scope)
  const [draft, setDraft] = useState(initial)
  // The server value the draft was last seeded from, and whether the next
  // revision change is one this editor is about to cause.
  const [base, setBase] = useState<{ revision: unknown; initial: T }>({
    revision,
    initial,
  })
  const [ownSave, setOwnSave] = useState(false)
  const [incoming, setIncoming] = useState(false)

  // Follow a new server revision during render (React's "adjusting state
  // when a prop changes"), so there is never a frame that shows the old
  // draft against the new value.
  if (!Object.is(base.revision, revision)) {
    const hadEdits = !isEqual(draft, base.initial)
    const follow =
      !hadEdits || ownSave || missing(base.revision) || isEqual(draft, initial)
    setBase({ revision, initial })
    setOwnSave(false)
    if (follow) {
      setDraft(initial)
      setIncoming(false)
    } else {
      setIncoming(true)
    }
  }

  // The signed-in identity the draft was written under. When the key names
  // someone else (another account signed in from a second tab, without a
  // reload), the in-memory edits are the previous person's: go back to the
  // server value rather than show them, or stash them, as the new person's.
  // A first known identity after an unknown one adopts the draft.
  const owner = draftKeyOwner(key)
  const [draftOwner, setDraftOwner] = useState(owner)
  if (owner !== draftOwner) {
    if (draftOwner !== null) {
      setDraft(initial)
      setBase({ revision, initial })
      setOwnSave(false)
      setIncoming(false)
    }
    setDraftOwner(owner)
  }

  const isDirty = !isEqual(draft, initial)

  const { confirmDiscard, markDiscarded, restore } = useDirtyGuard({
    key,
    isDirty,
    snapshot: () => JSON.stringify(draft),
  })

  // A draft stashed by an earlier visit, read once on mount without
  // consuming it, and offered only when it differs from the server copy.
  // Restoring or dismissing it is what clears it.
  //
  // An editor whose data was streamed from the server (hours, photos, posts)
  // is hydrated, not mounted fresh: its first browser render must match the
  // server's, which had no stash. So the read waits for the render after
  // hydration (`useHydrated`: false only in the server render and while
  // hydrating) and the offer appears then; an editor mounted in the browser
  // reads on its first render, as before.
  //
  // Read per key: when the key changes (the session's identity became known
  // or changed) the stash read under the old key is dropped, never offered
  // under the new one.
  const readStash = (forKey: string): { value: T } | null => {
    const raw = peekStashedDraft(forKey)
    if (raw === null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      const value = parseStashed ? parseStashed(parsed) : parsed as T
      return value === null ? null : { value }
    } catch {
      // A corrupt stash is ignored, as if it had never been written.
      return null
    }
  }
  const canReadStash = useHydrated()
  const [stashState, setStashState] = useState<{
    key: string | null
    stash: { value: T } | null
  }>(() =>
    canReadStash ? { key, stash: readStash(key) } : { key: null, stash: null }
  )
  if (canReadStash && stashState.key !== key)
    setStashState({ key, stash: readStash(key) })
  const stash = stashState.key === key ? stashState.stash : null
  const setStash = useCallback(
    (next: null) => setStashState({ key, stash: next }),
    [key]
  )
  // Wait for a real server value before offering it, so the seed that
  // follows a missing revision doesn't overwrite what was restored.
  const stashed =
    stash !== null && !missing(revision) && !isEqual(stash.value, initial)

  const discard = useCallback(() => {
    setDraft(initial)
    setIncoming(false)
  }, [initial])
  const expectSave = useCallback(() => setOwnSave(true), [])
  const loadIncoming = useCallback(() => {
    setDraft(initial)
    setIncoming(false)
  }, [initial])
  const keepMine = useCallback(() => setIncoming(false), [])
  const restoreStashed = useCallback(() => {
    restore()
    if (stash) setDraft(stash.value)
    setStash(null)
  }, [restore, setStash, stash])
  const dismissStashed = useCallback(() => {
    restore()
    setStash(null)
  }, [restore, setStash])

  return {
    draft,
    setDraft,
    isDirty,
    discard,
    confirmDiscard,
    forget: markDiscarded,
    expectSave,
    incoming: incoming && isDirty,
    loadIncoming,
    keepMine,
    stashed,
    restoreStashed,
    dismissStashed,
  }
}
