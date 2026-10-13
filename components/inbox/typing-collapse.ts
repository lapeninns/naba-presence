/**
 * Folds the publish bar to its button while the reply is being typed on a
 * phone or a touch screen, or while the on-screen keyboard is up. With the
 * keyboard open, the bar's status words sat over the very lines being
 * written; Publish stays, so the reply can still be sent from where it is.
 *
 * CSS only, for the status slot beside the bar's actions: `group/pane` is the
 * review pane (components/inbox/review-detail.tsx), and the rule matches
 * while a textarea inside it has focus. `keyboard-open` is set on <html> by
 * the shell (components/app-shell/viewport-insets.tsx).
 */
export const TYPING_COLLAPSE_CLASS =
  "max-md:group-has-[textarea:focus]/pane:hidden pointer-coarse:group-has-[textarea:focus]/pane:hidden keyboard-open:hidden"
