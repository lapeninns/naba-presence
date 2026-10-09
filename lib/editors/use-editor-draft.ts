"use client"

import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { peekStashedDraft } from "@/lib/api/draft-stash"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"

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
  key,
}: {
  initial: T
  /** Token that changes when the SERVER value changes — usually a revision. */
  revision: unknown
  /** Stash key, unique per location and resource. */
  key: string
}): EditorDraft<T> {
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
    const hadEdits = !same(draft, base.initial)
    const follow =
      !hadEdits || ownSave || missing(base.revision) || same(draft, initial)
    setBase({ revision, initial })
    setOwnSave(false)
    if (follow) {
      setDraft(initial)
      setIncoming(false)
    } else {
      setIncoming(true)
    }
  }

  const isDirty = !same(draft, initial)

  const { confirmDiscard, markDiscarded, restore } = useDirtyGuard({
    key,
    isDirty,
    snapshot: () => JSON.stringify(draft),
  })

  // A draft stashed by an earlier visit, read once on mount without
  // consuming it (the editors render on the client only: their data is never
  // prefetched), and offered only when it differs from the server copy.
  // Restoring or dismissing it is what clears it.
  const [stash, setStash] = useState<{ value: T } | null>(() => {
    const raw = peekStashedDraft(key)
    if (raw === null) return null
    try {
      return { value: JSON.parse(raw) as T }
    } catch {
      // A corrupt stash is ignored, as if it had never been written.
      return null
    }
  })
  // Wait for a real server value before offering it, so the seed that
  // follows a missing revision doesn't overwrite what was restored.
  const stashed =
    stash !== null && !missing(revision) && !same(stash.value, initial)

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
  }, [restore, stash])
  const dismissStashed = useCallback(() => {
    restore()
    setStash(null)
  }, [restore])

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
