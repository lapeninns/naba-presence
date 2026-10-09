/**
 * Folds the publish bar to its button while the reply is being typed on a
 * phone or a touch screen. With the on-screen keyboard up, the bar's status
 * line and reason sat over the very lines being written.
 *
 * CSS only: `group/pane` is the review pane (components/inbox/review-detail.tsx),
 * and the rule matches while a textarea inside it has focus.
 */
export const TYPING_COLLAPSE_CLASS =
  "max-md:group-has-[textarea:focus]/pane:hidden pointer-coarse:group-has-[textarea:focus]/pane:hidden"
