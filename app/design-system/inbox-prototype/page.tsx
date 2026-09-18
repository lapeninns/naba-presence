import { InboxPrototype } from "./inbox-prototype"

// A preview route beside the other design-system specimens. The production
// Reviews route at /inbox and components/inbox/* are untouched; this page
// renders its own components on sample data so the direction can be reviewed
// before anything migrates.
export const metadata = {
  title: "Reviews inbox prototype · NabaPresence",
}

export default function InboxPrototypePage() {
  return <InboxPrototype />
}
