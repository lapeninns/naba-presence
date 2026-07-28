## How to build with NabaReview

shadcn/ui (`base-rhea` style) on **Base UI** primitives, styled with **Tailwind v4** utilities that
resolve to semantic CSS-variable tokens. The palette is Google Business Profile's.

### This is Base UI, not Radix — `render`, never `asChild`

The single most common mistake. There is **no `asChild` prop anywhere in this library**. To make a
trigger render as your own element, pass it to `render`:

```tsx
<DialogTrigger render={<Button>Reply</Button>} />
<BreadcrumbLink render={<a href="/locations" />} />
```

Writing `asChild` produces a silently wrong DOM. Related Base UI differences worth knowing:
`Accordion`'s value is an **array** (`defaultValue={["faq-1"]}` — there is no `type="single"`);
`Slider` needs an **array** value even for one thumb (a scalar renders two); `Select`'s root needs
`items` for a closed `SelectValue` to show a label; `ResizablePanelGroup` takes **`orientation`**,
not `direction`; `Avatar` takes a **`size` prop** (`"default" | "sm" | "lg"`) — sizing it with a
`size-*` class breaks `AvatarBadge`/`AvatarGroupCount`, which scale off it.

### Providers

Most components need nothing. These do — mount the provider once, near your app root:

| Component | Needs |
|---|---|
| `Tooltip` | `TooltipProvider` |
| `Sidebar` | `SidebarProvider` (+ `SidebarInset` around main content) |
| `Toast` | `ToastProvider` + a `ToastViewport` |
| `MessageScroller` | `MessageScrollerProvider` |
| RTL layouts | `DirectionProvider` **plus** `dir` on a real element — it renders no DOM itself |

Dark mode is a `.dark` class on an ancestor. No theme provider is required; the tokens ship in CSS.

### The styling idiom: semantic tokens, never raw colour

Style with Tailwind utilities bound to these tokens. **Never** hardcode a hex value or reach for
`bg-blue-600` — that is how a design drifts off-brand.

| Purpose | Classes |
|---|---|
| Surfaces | `bg-background` `bg-card` `bg-popover` `bg-muted` `bg-secondary` `bg-accent` `bg-input` |
| Text | `text-foreground` `text-muted-foreground` `text-card-foreground` `text-primary` `text-primary-foreground` `text-secondary-foreground` `text-accent-foreground` |
| Semantic state | `text-destructive` `text-success` `text-warning` |
| Review stars | `fill-rating text-rating` |
| Lines & focus | `border-border` `border-input` `ring-ring` |
| Charts | `var(--chart-1)` … `var(--chart-5)` |
| Type | `font-sans` (Geist) · `font-mono` (Geist Mono) — use mono for numerals, IDs, timestamps |

Radius is `--radius` (0.625rem); controls are `rounded-2xl` by default. Keep one density per
surface. Two palette behaviours that look like bugs but are intentional: `destructive` renders as
**red text on a tint**, not a solid red fill; and dropdown/select/context menus deliberately open
as a **dark translucent surface in both themes**.

### Composition

Compound components ship their parts as separate exports — `CardHeader`, `TableCell`,
`SelectItem`, `FieldLabel` and so on. They have no preview card of their own but are all importable
from the bundle, and each parent's doc lists its parts. Reach for the DS primitive rather than a
raw `div`/`button`/`input`, and use **`AlertDialog`, not `Dialog`, for destructive confirmation**.
Form fields are identified by their label and focus ring, not a visible border — **always pair a
control with its `Label`**.

### Where the truth lives

Read these before styling: `_ds/<folder>/styles.css` and the files it imports (tokens, fonts, and
all component CSS), and the per-component `.prompt.md`, which carries that component's purpose,
its parts list, and its props.

### An idiomatic example

Icons come from `lucide-react` (`Star` below), not from this library:

```tsx
<Card className="max-w-md">
  <CardHeader>
    <div className="flex items-start gap-3">
      <Avatar size="sm"><AvatarFallback>PS</AvatarFallback></Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle className="text-base">Priya Sharma</CardTitle>
        <div className="flex items-center gap-2">
          <Star className="size-4 fill-rating text-rating" />
          <span className="text-xs text-muted-foreground">2 days ago</span>
        </div>
      </div>
    </div>
    <CardAction><Badge variant="secondary">Replied</Badge></CardAction>
  </CardHeader>
  <CardContent className="text-sm text-muted-foreground">
    Stayed two nights and the front desk could not have been kinder.
  </CardContent>
  <CardFooter className="gap-2">
    <Button>Post reply</Button>
    <Button variant="ghost">Save draft</Button>
  </CardFooter>
</Card>
```

DS components carry the controls; Tailwind token utilities carry your own layout glue.
