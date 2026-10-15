"use client"

import { useState } from "react"

import { Save } from "lucide-react"

import { EditorFooter } from "@/components/editors/editor-footer"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * The action bar for a task: status, ONE primary, the rest in an overflow.
 * Client component because the specimens take handlers.
 *
 * Reuse notes (publish failure view, post composer, any editor):
 * - Give `ActionBar` `status`, `primary` and `secondaryActions`. From `md`
 *   the secondaries are inline buttons; below it they fold into one
 *   "More actions" menu button (44px), so a phone keeps one row.
 * - `dock` fixes the bar to the phone's bottom edge and publishes its measured
 *   height as `--np-dock-bar-h`, which the toast and the scroll padding read.
 *   Never hand-write `fixed` or `data-docked`.
 * - A bar with nothing to do is not drawn: pass `visible={isDirty}` or return
 *   null. Leave out a secondary that has no use rather than greying it.
 */
export function UxP02Demo() {
  const [dirty, setDirty] = useState(false)
  const [log, setLog] = useState("Nothing yet")
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-canvas p-4 text-ink">
        <h3 className="text-ui font-medium">
          ActionBar: status, primary, overflow
        </h3>
        <ActionBar
          sticky={false}
          safeArea={false}
          label="Action bar with an overflow, sample"
          status={
            <span>
              <strong className="font-medium">2 changes not on Google</strong>{" "}
              <ActionBarMuted>· unsaved edits</ActionBarMuted>
            </span>
          }
          secondaryActions={[
            {
              label: "Save here",
              icon: <Save aria-hidden />,
              onClick: () => setLog("Save here"),
            },
            {
              label: "Discard edits",
              destructive: true,
              onClick: () => setLog("Discard edits"),
            },
          ]}
          primary={
            <Button onClick={() => setLog("Review changes")}>
              Review changes
            </Button>
          }
        />
        <p className="text-caption text-ink-muted">
          Last action: {log}. Below 48rem the two secondaries sit in the “More
          actions” menu.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-canvas p-4 text-ink">
        <h3 className="text-ui font-medium">Editor footer: none while clean</h3>
        <Input
          aria-label="Business name, sample"
          defaultValue="The Bell"
          onChange={() => setDirty(true)}
        />
        <p className="text-caption text-ink-muted">
          Edit the field and the footer arrives: docked on a phone, inline under
          the form from 48rem. Discarding or reviewing clears it.
        </p>
        <EditorFooter
          status={dirty ? "edited" : "in_sync"}
          isDirty={dirty}
          changeCount={dirty ? 1 : 0}
          onSave={() => setDirty(false)}
          onReview={() => setDirty(false)}
          onDiscard={() => setDirty(false)}
        />
      </div>
    </div>
  )
}
