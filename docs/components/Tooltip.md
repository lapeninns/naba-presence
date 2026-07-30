---
category: Feedback
---

Short hover/focus hint.

Needs a `TooltipProvider` above it — mount one once at the app root. Pass the trigger via `TooltipTrigger`'s `render` prop. Never put essential information or interactive content in a tooltip.

## Parts

Composed inside `<Tooltip>`, each importable from `window.NabaPresence.*`:

- `TooltipContent`
- `TooltipProvider`
- `TooltipTrigger`
