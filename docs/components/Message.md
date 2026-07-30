---
category: AI & Chat
---

A single conversation turn.

Compose `MessageAvatar`, `MessageHeader`, `MessageContent`, and `MessageFooter`; wrap consecutive turns in `MessageGroup`. Set the sending side with the **`align` prop** — `align="end"` (the component writes `data-align` itself; do not hand-author that attribute).

## Parts

Composed inside `<Message>`, each importable from `window.NabaPresence.*`:

- `MessageAvatar`
- `MessageContent`
- `MessageFooter`
- `MessageGroup`
- `MessageHeader`
