---
category: AI & Chat
---

File attachment chip with preview and actions.

Compose `AttachmentMedia` for the thumbnail, `AttachmentContent` (with `AttachmentTitle`/`AttachmentDescription`), and `AttachmentActions`. `AttachmentGroup` lays out multiple files; the error state is driven by `data-state="error"`.

## Parts

Composed inside `<Attachment>`, each importable from `window.NabaPresence.*`:

- `AttachmentAction`
- `AttachmentActions`
- `AttachmentContent`
- `AttachmentDescription`
- `AttachmentGroup`
- `AttachmentMedia`
- `AttachmentTitle`
- `AttachmentTrigger`
