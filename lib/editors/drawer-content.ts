/**
 * Marks an overlay body as Base UI drawer content, so a mouse press inside
 * it is a click and not the start of a swipe.
 *
 * Why: on the sheet presentation the Base UI Drawer treats a pointerdown on
 * anything it does not recognise as interactive (a segmented radio's span, a
 * `<summary>`) as the start of a swipe and captures the pointer, so the
 * click lands on the popup and the radio never checks / the disclosure never
 * opens. Base UI exempts `[data-drawer-content]` (what `Drawer.Content`
 * renders). components/ui/sheet.tsx and the Dialog's sheet body do not use
 * `Drawer.Content` yet; once they do, drop these spreads.
 */
export const drawerContentProps = { "data-drawer-content": "" } as const
