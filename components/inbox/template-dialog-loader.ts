/**
 * The one place the template batch's code is imported from, so that the
 * Inbox's first load does not carry it (see bulk-action-bar.tsx). Kept on its
 * own so a test can hold the download without reaching into the bundler.
 */
export const importTemplateReplyDialog = () =>
  import("@/components/inbox/template-reply-dialog")
