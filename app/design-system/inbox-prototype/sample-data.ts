import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * Sample content for the prototype only.
 *
 * Nothing here comes from a Business Profile. The names, venues, ratings,
 * timestamps and activity entries are written to exercise the layout: the
 * rating range, a translated review, a published owner reply and one review
 * long enough to prove the two-line truncation.
 */

export const QUEUES = [
  { id: "needs_reply", label: "Needs reply", count: 8 },
  { id: "approval", label: "Approval", count: 3 },
  { id: "publishing", label: "Publishing", count: 1 },
  { id: "failed", label: "Failed", count: 0 },
  { id: "done", label: "Done", count: 24 },
] as const

export type QueueId = (typeof QUEUES)[number]["id"]

export type SampleReview = {
  id: string
  reviewer: string
  initials: string
  venue: string
  posted: string
  relative: string
  rating: number
  source: string
  status: { label: string; tone: StatusTone }
  translatedFrom?: string
  body: string
  ownerReply?: string
}

export const SAMPLE_REVIEWS: SampleReview[] = [
  {
    id: "rv-01",
    reviewer: "Priya Raman",
    initials: "PR",
    venue: "Harbour Yard",
    posted: "12 September 2026",
    relative: "2 hours ago",
    rating: 2,
    source: "Business Profile",
    status: { label: "Needs reply", tone: "attention" },
    body: "Booked a table for six at seven and waited forty minutes before anyone came over. The food was good when it arrived, and the person who took our order could not have been kinder about it, but nobody told us there was a delay until we asked. If the kitchen is behind on a Friday, say so when we sit down and we will happily wait with a drink.",
  },
  {
    id: "rv-02",
    reviewer: "Tom Alderidge",
    initials: "TA",
    venue: "The Lower Mill",
    posted: "12 September 2026",
    relative: "4 hours ago",
    rating: 5,
    source: "Business Profile",
    status: { label: "Needs reply", tone: "attention" },
    body: "Sunday lunch here has become the thing we plan the week around. The beef was properly rested, the potatoes were the reason we came back, and the room stayed warm and loud in the right way. Whoever runs the pass on a Sunday deserves to hear it.",
  },
  {
    id: "rv-03",
    reviewer: "Marta Voss",
    initials: "MV",
    venue: "Harbour Yard",
    posted: "11 September 2026",
    relative: "Yesterday",
    rating: 4,
    source: "Business Profile",
    status: { label: "Drafted", tone: "pending" },
    translatedFrom: "German",
    body: "A good stop before the ferry. Quick service, fair prices, and the staff switched to English without making us feel awkward about asking. The only thing I would change is the music, which was louder than the room needed at lunchtime.",
  },
  {
    id: "rv-04",
    reviewer: "Dan Okafor",
    initials: "DO",
    venue: "Girton Tap",
    posted: "11 September 2026",
    relative: "Yesterday",
    rating: 1,
    source: "Business Profile",
    status: { label: "Needs reply", tone: "at-risk" },
    body: "Arrived for a booking that was not in the book. We were turned away at the door on a wet evening with no offer to find us a table anywhere else. I understand mistakes happen; what I did not expect was to be told it was our fault.",
  },
  {
    id: "rv-05",
    reviewer: "Helen Brady",
    initials: "HB",
    venue: "The Lower Mill",
    posted: "10 September 2026",
    relative: "2 days ago",
    rating: 5,
    source: "Business Profile",
    status: { label: "Published", tone: "healthy" },
    body: "Took my mother for her birthday and they had put a card on the table without being asked twice. Small thing, made the afternoon.",
    ownerReply:
      "Thank you for telling us. The card was Ruth's idea and I have passed this on to her. We hope to see you both again soon.",
  },
  {
    id: "rv-06",
    reviewer: "Jae Lin",
    initials: "JL",
    venue: "Girton Tap",
    posted: "10 September 2026",
    relative: "2 days ago",
    rating: 3,
    source: "Business Profile",
    status: { label: "Needs reply", tone: "attention" },
    body: "Fine for a quick pint and the garden is a real asset on a warm evening. The food menu felt thinner than the board outside suggested, and two of the taps were off.",
  },
  {
    id: "rv-07",
    reviewer: "Ros Whitaker",
    initials: "RW",
    venue: "Harbour Yard",
    posted: "9 September 2026",
    relative: "3 days ago",
    rating: 4,
    source: "Business Profile",
    status: { label: "Needs reply", tone: "attention" },
    body: "Good wine list with enough by the glass to make a proper evening of it. Parking is the weak point: the sign points at a car park that fills by six.",
  },
  {
    id: "rv-08",
    reviewer: "Sam Ferreira",
    initials: "SF",
    venue: "The Lower Mill",
    posted: "9 September 2026",
    relative: "3 days ago",
    rating: 5,
    source: "Business Profile",
    status: { label: "Drafted", tone: "pending" },
    body: "Wake for my uncle last month. They handled the room, the timings and the questions we had not thought to ask, and left us alone when we needed it.",
  },
]

export const TONE_CHIPS = [
  "Acknowledge",
  "Apologise",
  "Explain",
  "Invite back",
  "Thank",
] as const

export const ACTIVITY_ENTRIES = [
  { time: "09:14", actor: "System", action: "Review received" },
  { time: "09:20", actor: "Ava Mensah", action: "Draft written" },
  { time: "10:02", actor: "Ava Mensah", action: "Draft edited" },
  { time: "11:37", actor: "Tom Reid", action: "Approved" },
  { time: "11:41", actor: "System", action: "Published to the profile" },
] as const

export const SHORTCUTS = [
  { index: "01", label: "Move through the queue", keys: ["J", "K"] },
  { index: "02", label: "Start a reply", keys: ["R"] },
  { index: "03", label: "Mark handled", keys: ["E"] },
  { index: "04", label: "Open the command palette", keys: ["⌘", "K"] },
  { index: "05", label: "Publish the reply", keys: ["⌘", "↵"] },
  { index: "06", label: "Close the sheet", keys: ["Esc"] },
] as const
