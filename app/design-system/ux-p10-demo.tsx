"use client"

import { ArchiveIcon, CheckIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ListRow, ListRows } from "@/components/ui/list-row"

const ROWS = [
  { id: "amelia", title: "Amelia Hart", preview: "We waited forty minutes." },
  {
    id: "tom",
    title: "Tom Reeve",
    preview: "Lovely staff, great Sunday roast.",
  },
  {
    id: "priya",
    title: "Priya Nair",
    preview: "Booked for six, seated for five.",
  },
]

/**
 * Row actions: a trailing swipe on a list row, always paired with a visible
 * "⋯" button (WCAG 2.5.7). Swipe left on a touch screen, or use the button.
 */
function UxP10Demo() {
  const [log, setLog] = React.useState("No action yet.")
  return (
    <section
      id="ux-p10-row-actions"
      className="flex min-w-0 flex-col gap-3"
      aria-labelledby="ux-p10-row-actions-title"
    >
      <h3
        id="ux-p10-row-actions-title"
        className="text-section font-semibold text-ink"
      >
        Row actions
      </h3>
      <p className="max-w-(--np-measure-reading) text-ui text-ink-secondary">
        One or two quick actions on a row. On a touch screen, swipe left to
        reveal them; the ⋯ button at the end of the row opens the same actions
        for a keyboard, a mouse or a finger that does not swipe. Tap elsewhere,
        scroll or press Escape to close an open row.
      </p>
      <ListRows className="max-w-sm overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
        {ROWS.map((row, index) => (
          <ListRow
            key={row.id}
            title={row.title}
            preview={row.preview}
            emphasis="neutral"
            // Row-specific, so a screen reader can tell the buttons apart.
            actionsLabel={`Actions for ${row.title}`}
            onClick={() => setLog(`Opened ${row.title}.`)}
            swipeActions={
              index === 2
                ? [
                    {
                      label: "Done",
                      icon: <CheckIcon aria-hidden />,
                      onAction: () => setLog(`Marked ${row.title} done.`),
                    },
                    {
                      label: "Delete",
                      icon: <Trash2Icon aria-hidden />,
                      tone: "danger",
                      onAction: () => setLog(`Deleted ${row.title}.`),
                    },
                  ]
                : [
                    {
                      label: "Archive",
                      icon: <ArchiveIcon aria-hidden />,
                      onAction: () => setLog(`Archived ${row.title}.`),
                    },
                  ]
            }
          />
        ))}
      </ListRows>
      <p
        role="status"
        data-testid="ux-p10-log"
        className="text-caption text-ink-muted"
      >
        {log}
      </p>
    </section>
  )
}

export { UxP10Demo }
