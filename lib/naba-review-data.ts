export type ReviewStatus =
  "needs_reply" | "awaiting_approval" | "published" | "escalated"

export type VerificationStatus = "pass" | "warn" | "fail" | "pending"

export type Review = {
  id: string
  reviewer: string
  initials: string
  rating: number
  location: string
  locationId?: string
  excerpt: string
  text: string
  postedAt: string
  updatedAt: string
  language: string
  status: ReviewStatus
  verification: VerificationStatus
  draft: string
  draftId?: string
  sourceUpdateTime?: string
  sourceCreateTime?: string
  replyStatus?: string
  syncStatus?: string
  responseTime?: string
  googleState?: "APPROVED" | "PENDING" | "REJECTED"
  theme: string
}

export const INITIAL_REVIEWS: Review[] = [
  {
    id: "rev-001",
    reviewer: "Alice Morgan",
    initials: "AM",
    rating: 4,
    location: "London Mayfair",
    excerpt:
      "Lovely stay and genuinely kind staff. The room was quiet and breakfast was excellent.",
    text: "Lovely stay and genuinely kind staff. The room was quiet, spotless and breakfast was excellent. Check-in took a little longer than expected, but the team kept us updated and made us feel welcome.",
    postedAt: "Today, 09:42",
    updatedAt: "Today, 09:42",
    language: "English",
    status: "needs_reply",
    verification: "pass",
    draft:
      "Thank you, Alice. We’re delighted you enjoyed the quiet room, breakfast and the warm welcome from our team. We also appreciate your patience at check-in and will share your feedback with our front desk colleagues. We hope to welcome you back to London Mayfair soon.",
    theme: "Service",
  },
  {
    id: "rev-002",
    reviewer: "Daniel Reed",
    initials: "DR",
    rating: 1,
    location: "Birmingham NEC",
    excerpt:
      "The room was cold when I arrived and I had to wait far too long for help at reception.",
    text: "The room was cold when I arrived and I had to wait far too long for help at reception. The staff member eventually found a heater, but this should have been sorted before check-in.",
    postedAt: "Today, 08:16",
    updatedAt: "Today, 08:16",
    language: "English",
    status: "escalated",
    verification: "warn",
    draft:
      "Daniel, we’re sorry your room was not ready at a comfortable temperature and that support took too long. This is not the arrival we aim to provide. We have shared your comments with the hotel team so they can review what happened and follow up appropriately.",
    theme: "Room comfort",
  },
  {
    id: "rev-003",
    reviewer: "Priya Shah",
    initials: "PS",
    rating: 5,
    location: "London Mayfair",
    excerpt:
      "Perfect location, thoughtful team and a brilliant breakfast. We will absolutely return.",
    text: "Perfect location, thoughtful team and a brilliant breakfast. We will absolutely return.",
    postedAt: "Yesterday, 18:04",
    updatedAt: "Yesterday, 18:04",
    language: "English",
    status: "awaiting_approval",
    verification: "pass",
    draft:
      "Thank you, Priya. We’re so pleased the location, breakfast and care from our team made your stay memorable. We look forward to welcoming you back.",
    theme: "Location",
  },
  {
    id: "rev-004",
    reviewer: "Marcus Weber",
    initials: "MW",
    rating: 5,
    location: "Leeds City",
    excerpt: "Fast check-in, comfortable bed and a very helpful night manager.",
    text: "Fast check-in, comfortable bed and a very helpful night manager. Thank you for a smooth stay.",
    postedAt: "Yesterday, 15:31",
    updatedAt: "Yesterday, 15:31",
    language: "English",
    status: "published",
    verification: "pass",
    draft:
      "Thank you, Marcus. We’re glad you had a smooth arrival and a comfortable stay. Your kind words will be shared with our night team.",
    responseTime: "42 min",
    googleState: "APPROVED",
    theme: "Check-in",
  },
  {
    id: "rev-005",
    reviewer: "Sofia Rossi",
    initials: "SR",
    rating: 3,
    location: "Birmingham NEC",
    excerpt:
      "Convenient for the NEC and friendly service, though the breakfast area felt crowded.",
    text: "Convenient for the NEC and friendly service, though the breakfast area felt crowded at 8am.",
    postedAt: "Mon, 12:20",
    updatedAt: "Mon, 12:20",
    language: "English",
    status: "needs_reply",
    verification: "pending",
    draft:
      "Thank you, Sofia. We’re pleased our location and team worked well for your visit. We also appreciate your note about breakfast at peak time and will share it with the hotel team.",
    theme: "Breakfast",
  },
  {
    id: "rev-006",
    reviewer: "Noah Williams",
    initials: "NW",
    rating: 4,
    location: "Leeds City",
    excerpt:
      "A calm, comfortable stay. The team gave excellent local recommendations.",
    text: "A calm, comfortable stay. The team gave excellent local recommendations and the room was very clean.",
    postedAt: "Mon, 09:10",
    updatedAt: "Mon, 09:10",
    language: "English",
    status: "published",
    verification: "pass",
    draft:
      "Thank you, Noah. We’re delighted you had a calm and comfortable stay, and that our team’s local recommendations were useful. We hope to see you again.",
    responseTime: "1 hr 18 min",
    googleState: "APPROVED",
    theme: "Service",
  },
]

export const LOCATIONS = [
  "All locations",
  "London Mayfair",
  "Birmingham NEC",
  "Leeds City",
] as const

export const PERFORMANCE_DATA = [
  { day: "22 Jul", reviews: 7, replies: 5 },
  { day: "23 Jul", reviews: 10, replies: 8 },
  { day: "24 Jul", reviews: 8, replies: 8 },
  { day: "25 Jul", reviews: 12, replies: 10 },
  { day: "26 Jul", reviews: 9, replies: 8 },
  { day: "27 Jul", reviews: 14, replies: 13 },
  { day: "28 Jul", reviews: 11, replies: 9 },
]

export const LOCATION_METRICS = [
  {
    location: "London Mayfair",
    rating: "4.7",
    reviews: 184,
    responseRate: "96%",
    median: "2h 08m",
  },
  {
    location: "Leeds City",
    rating: "4.5",
    reviews: 126,
    responseRate: "93%",
    median: "3h 22m",
  },
  {
    location: "Birmingham NEC",
    rating: "4.2",
    reviews: 149,
    responseRate: "88%",
    median: "5h 11m",
  },
]
