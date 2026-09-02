import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"

/**
 * The "Save changes / Saving… + Publish to Google + gate note" block shared by
 * the canonical-draft tabs (hours, menu). Copy, roles and button names are
 * asserted by tests/e2e/locations.spec.ts — keep them stable.
 *
 * `editReason` / `publishReason` are the shell's gate reasons: save is blocked
 * while editing is, publish while publishing is, and the note explains
 * whichever applies first (edit outranks publish, matching the tabs' previous
 * `editReason ?? publishReason`). Pass `note` to override that composition.
 */
export function SaveBar({
  onSave,
  onPublish,
  isDirty,
  saving,
  publishing,
  editReason,
  publishReason,
  note,
}: {
  onSave: () => void
  onPublish: () => void
  /** Whether the local draft differs from the saved canonical value. */
  isDirty: boolean
  saving: boolean
  publishing: boolean
  editReason: string | null
  publishReason: string | null
  /** Overrides the gate note; defaults to `editReason ?? publishReason`. */
  note?: string | null
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onSave}
          disabled={editReason !== null || !isDirty || saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button
          variant="outline"
          onClick={onPublish}
          disabled={publishReason !== null || publishing}
        >
          Publish to Google
        </Button>
      </div>
      <GateNote
        reason={note === undefined ? (editReason ?? publishReason) : note}
      />
    </>
  )
}
