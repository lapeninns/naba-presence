---
category: AI & Chat
---

Auto-scrolling transcript viewport that follows streaming output.

Wrap in `MessageScrollerProvider`, then compose `MessageScrollerViewport` > `MessageScrollerContent` > `MessageScrollerItem`. `MessageScrollerButton` jumps back to the latest message.

## Parts

Composed inside `<MessageScroller>`, each importable from `window.NabaReview.*`:

- `MessageScrollerButton`
- `MessageScrollerContent`
- `MessageScrollerItem`
- `MessageScrollerProvider`
- `MessageScrollerViewport`
