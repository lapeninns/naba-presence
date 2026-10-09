"use client"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { EditorDraft } from "@/lib/editors/use-editor-draft"
import { useLeaveGuard } from "@/lib/editors/use-leave-guard"

type DraftLike = Pick<
  EditorDraft<unknown>,
  | "isDirty"
  | "forget"
  | "incoming"
  | "loadIncoming"
  | "keepMine"
  | "stashed"
  | "restoreStashed"
  | "dismissStashed"
>

/**
 * What an editor says about its drafts beyond the fields themselves, for
 * one or more `useEditorDraft` results that make up one editor (the profile
 * has three):
 *
 *   - edits left behind by an earlier visit, offered back ("Restore");
 *   - a newer version saved by someone else while these edits were open,
 *     with the choice of whose to keep;
 *   - the leave prompt, when an in-app link would throw unsaved edits away.
 *
 * `noun` names the thing ("these hours", "this menu").
 */
function DraftNotices({ drafts, noun }: { drafts: DraftLike[]; noun: string }) {
  const dirty = drafts.some((draft) => draft.isDirty)
  const leave = useLeaveGuard({
    when: dirty,
    onLeave: () => drafts.forEach((draft) => draft.forget()),
  })
  const stashed = drafts.filter((draft) => draft.stashed)
  const incoming = drafts.filter((draft) => draft.incoming)

  return (
    <>
      {stashed.length > 0 ? (
        <Alert variant="info" data-slot="draft-restore">
          <AlertTitle>You left unsaved edits to {noun}</AlertTitle>
          <AlertDescription>
            They were kept in this browser tab when you last left the page.
            Restore them to carry on, or dismiss them to start from what
            NabaPresence has saved.
          </AlertDescription>
          <AlertActions>
            <Button
              size="sm"
              onClick={() => stashed.forEach((draft) => draft.restoreStashed())}
            >
              Restore unsaved edits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stashed.forEach((draft) => draft.dismissStashed())}
            >
              Dismiss
            </Button>
          </AlertActions>
        </Alert>
      ) : null}

      {incoming.length > 0 ? (
        <Alert variant="warning" data-slot="draft-incoming">
          <AlertTitle>
            Someone else saved {noun} while you were editing
          </AlertTitle>
          <AlertDescription>
            Your edits are still here and nothing was lost. Load their version
            to start again from it, or keep yours; saving yours replaces theirs.
          </AlertDescription>
          <AlertActions>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => incoming.forEach((draft) => draft.loadIncoming())}
            >
              Load theirs
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => incoming.forEach((draft) => draft.keepMine())}
            >
              Keep mine
            </Button>
          </AlertActions>
        </Alert>
      ) : null}

      <DiscardDialog
        {...leave}
        title="Leave without saving?"
        confirmLabel="Leave and discard"
        announce={false}
        description={`Your edits to ${noun} aren’t saved. Leaving throws them away. Google is not affected.`}
      />
    </>
  )
}

export { DraftNotices }
