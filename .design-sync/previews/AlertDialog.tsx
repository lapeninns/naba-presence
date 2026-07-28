import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "NabaReview"
import { Trash2, Unplug } from "lucide-react"

/**
 * Destructive confirmation. Reach for AlertDialog — not Dialog — whenever the
 * confirming click cannot be undone, and spend the description on the actual
 * consequence rather than restating the title.
 */
export function DeleteReply() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this reply?</AlertDialogTitle>
          <AlertDialogDescription>
            Your published reply to Lena Fischer’s 2-star review is removed from
            Google within a few minutes. The review stays visible and returns to
            Awaiting reply.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep reply</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete reply</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * `AlertDialogMedia` moves the icon into its own column at sm and up, which
 * suits a consequence long enough to need two or three lines.
 */
export function DisconnectLocation() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Unplug className="text-muted-foreground" />
          </AlertDialogMedia>
          <AlertDialogTitle>Disconnect Riverside from Google?</AlertDialogTitle>
          <AlertDialogDescription>
            NabaReview stops syncing the 39 reviews for Lapen Inn — Riverside and
            the 4 replies scheduled for this week are cancelled. Reconnecting needs
            a Business Profile owner to re-authorise.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Disconnect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * `size="sm"` stays centre-aligned at every width and lays the footer out as
 * two equal columns — the right shape for a short, low-stakes confirmation.
 */
export function CompactDiscard() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 className="text-muted-foreground" />
          </AlertDialogMedia>
          <AlertDialogTitle>Discard draft?</AlertDialogTitle>
          <AlertDialogDescription>
            The reply you started for Marco Silva has not been posted and will not
            be recoverable.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
