---
category: AI & Chat
---

Chat bubble surface for message text.

Put text in `BubbleContent` and group consecutive bubbles in `BubbleGroup` — the variant styling targets `BubbleContent`, so a `Bubble` without it renders unstyled. Seven variants: `default` (primary fill, for the sending side), `secondary`, `muted`, `tinted`, `outline`, `ghost`, `destructive`. Set the sending side with `align="end"`. `BubbleReactions` appends reaction chips.

## Parts

Composed inside `<Bubble>`, each importable from `window.NabaPresence.*`:

- `BubbleContent`
- `BubbleGroup`
- `BubbleReactions`
