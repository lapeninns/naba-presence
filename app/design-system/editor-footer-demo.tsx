"use client"

import { useState } from "react"

import { EditorFooter } from "@/components/editors/editor-footer"

/**
 * The footer takes handlers, so its specimen has to be a client component:
 * a server component cannot pass a function across the boundary.
 */
export function EditorFooterDemo() {
  const [dirty, setDirty] = useState(true)
  return (
    <EditorFooter
      status={dirty ? "edited" : "in_sync"}
      isDirty={dirty}
      onReview={() => setDirty(false)}
      onDiscard={() => setDirty(false)}
      hint="Nothing to publish."
    />
  )
}
