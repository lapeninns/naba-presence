/**
 * The one place the Review details dialog's code is imported from, so that the
 * Inbox's first load does not carry it (see review-detail.tsx). Kept on its
 * own so a test can hold the download without reaching into the bundler.
 */
export const importReviewMetadata = () =>
  import("@/components/inbox/detail/review-metadata")
