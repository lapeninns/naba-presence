---
category: Data Display
---

User or entity image with a text fallback.

Always provide `AvatarFallback` — it shows while the image loads and when it fails. Size it with the `size` prop (`"default" | "sm" | "lg"`), **not** with a `className="size-*"` override: `AvatarBadge` and `AvatarGroupCount` size themselves from the avatar's `data-size`, so a class-only override produces a correctly-sized avatar with a wrongly-sized badge. `AvatarGroup` with `AvatarGroupCount` renders overlapping stacks; `AvatarBadge` adds a status dot. The group's overlap is tuned for images — at `default`/`sm` it can clip two-letter initials, so prefer `size="lg"` for initial-based stacks.

## Parts

Composed inside `<Avatar>`, each importable from `window.NabaReview.*`:

- `AvatarBadge`
- `AvatarFallback`
- `AvatarGroup`
- `AvatarGroupCount`
- `AvatarImage`
