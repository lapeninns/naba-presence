---
category: Layout
---

User-resizable split panes.

Set **`orientation`** to `"horizontal"` or `"vertical"` — this wraps react-resizable-panels **v4**, which has no `direction` prop. Passing `direction` is silently spread onto the div and the group stays horizontal. Compose `ResizablePanel` children separated by `ResizableHandle`, and give the group an explicit height or it collapses to nothing.

A numeric `defaultSize` on `ResizablePanel` means **pixels**; percentages must be strings (`defaultSize="40"`). `ResizablePanel`'s `className` lands on a nested inner div, not the panel element.

## Parts

Composed inside `<ResizablePanelGroup>`, each importable from `window.NabaReview.*`:

- `ResizableHandle`
- `ResizablePanel`
