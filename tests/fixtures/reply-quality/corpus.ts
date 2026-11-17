/**
 * Restaurant and pub reviews of every kind the reply generator has to
 * answer, each with a reply a manager could publish as it stands. Synthetic:
 * no real guest, venue or review. Shared by the rule-check corpus test
 * (tests/reply-quality.test.ts) and the opt-in live evaluation
 * (tests/reply-quality-live.test.ts).
 */
export type ReviewCase = {
  id: string
  kind:
    | "positive"
    | "constructive"
    | "mixed"
    | "negative"
    | "repeat"
    | "short"
    | "rating_only"
    | "detailed"
    | "sensitive"
  rating: number | null
  reviewerName: string | null
  reviewText: string | null
  /** A reply fit to publish for this review. */
  goodReply: string
}

export const VENUE = {
  name: "The Old Crown",
  locality: "Girton",
  category: "Pub",
  description:
    "A village pub in Girton serving British food, Sunday roasts and cask ales, with a garden.",
  menuItems: [
    "Steak and ale pie",
    "Fish and chips",
    "Sunday roast beef",
    "Sticky toffee pudding",
    "Mushroom wellington",
  ],
}

export const SIBLING_VENUES = ["The Railway", "The White Horse Inn"]

export const REVIEW_CASES: ReviewCase[] = [
  {
    id: "five-star-food",
    kind: "positive",
    rating: 5,
    reviewerName: "Hannah Wells",
    reviewText:
      "Best steak and ale pie I've had in years, proper pastry and loads of filling. Lovely fire going too.",
    goodReply:
      "Thanks, Hannah. Good to hear the pastry and the filling were both right. Glad the fire was lit for you as well.",
  },
  {
    id: "five-star-staff",
    kind: "positive",
    rating: 5,
    reviewerName: "Marcus",
    reviewText:
      "Ellie behind the bar was brilliant with our group of ten, nothing was too much trouble and the drinks kept coming.",
    goodReply:
      "Thank you, Marcus. A group of ten keeps a bar busy, so I'll make sure Ellie hears this. Good to know you were all looked after.",
  },
  {
    id: "five-star-ambience",
    kind: "positive",
    rating: 5,
    reviewerName: null,
    reviewText:
      "Sat in the garden on a sunny evening with a couple of pints. Relaxed, friendly, exactly what a village pub should be.",
    goodReply:
      "Thank you. A sunny evening in the garden is the pub at its best, and it's good to hear it felt relaxed. Enjoy the next one.",
  },
  {
    id: "four-star-suggestion",
    kind: "constructive",
    rating: 4,
    reviewerName: "Priya",
    reviewText:
      "Really good Sunday roast, generous portions. Only thing is there was just one vegetarian main, would be nice to have more choice.",
    goodReply:
      "Thanks, Priya. Glad the roast was generous. You're right that one vegetarian main isn't much of a choice, and I'll pass that on to the kitchen.",
  },
  {
    id: "four-star-wait",
    kind: "constructive",
    rating: 4,
    reviewerName: "Dan Fisher",
    reviewText:
      "Food was great when it came but we waited about 40 minutes on a Saturday night. Staff were apologetic and friendly.",
    goodReply:
      "Thanks, Dan. Forty minutes is longer than it should be, Saturday night or not, and I'm sorry you had that wait. Glad the food was worth it when it arrived and that the team kept you informed.",
  },
  {
    id: "three-star-mixed",
    kind: "mixed",
    rating: 3,
    reviewerName: "Jo",
    reviewText:
      "Nice pub and the fish and chips were good. Service was a bit hit and miss though, we had to go to the bar twice to ask for the bill.",
    goodReply:
      "Thank you, Jo. Good to hear the fish and chips went down well. Having to ask for the bill twice isn't good enough, and I'm sorry about that. I'll raise it with the team.",
  },
  {
    id: "three-star-price",
    kind: "mixed",
    rating: 3,
    reviewerName: null,
    reviewText:
      "Decent food but £19 for a burger is steep for a village pub. Atmosphere was good.",
    goodReply:
      "Thank you for the honest feedback. We know price matters and I'll pass your comment about the burger on. Glad you enjoyed the atmosphere.",
  },
  {
    id: "one-star-delay",
    kind: "negative",
    rating: 1,
    reviewerName: "Steve R",
    reviewText:
      "Waited over an hour for two mains, nobody came to tell us what was going on, and when the food arrived the chips were cold. Won't be back.",
    goodReply:
      "Steve, I'm sorry. Over an hour for two mains with nobody telling you why is not acceptable, and cold chips at the end of it makes it worse. Please get in touch with us at the pub directly so I can look into what happened that evening.",
  },
  {
    id: "two-star-food-quality",
    kind: "negative",
    rating: 2,
    reviewerName: "Amelia",
    reviewText:
      "The roast beef was tough and the vegetables were overcooked. For the price I expected much better. Staff were pleasant enough.",
    goodReply:
      "Amelia, thank you for telling us. Tough beef and overcooked vegetables are not what a Sunday roast here should be, and I'm sorry that's what you were served. I'll pass this on to the kitchen. If you're willing to tell me more, please get in touch with us directly.",
  },
  {
    id: "one-star-cleanliness",
    kind: "negative",
    rating: 1,
    reviewerName: null,
    reviewText:
      "Toilets were dirty and our table was sticky. Put me right off my food.",
    goodReply:
      "I'm sorry. Dirty toilets and a sticky table are not acceptable, and I understand why it put you off. Please get in touch with us directly and tell me when you visited, so I can look into it.",
  },
  {
    id: "one-star-booking",
    kind: "negative",
    rating: 1,
    reviewerName: "Gareth",
    reviewText:
      "Booked a table for 8 for my mum's birthday two weeks ahead. Turned up and they had no record of it and couldn't fit us in. Ruined the evening.",
    goodReply:
      "Gareth, I'm sorry. Arriving for your mum's birthday to find no record of a booking made two weeks earlier should not happen. Please get in touch with us at the pub directly so I can find out what went wrong with it.",
  },
  {
    id: "repeat-visitor",
    kind: "repeat",
    rating: 5,
    reviewerName: "Linda",
    reviewText:
      "We come here most Fridays and it never lets us down. Same friendly faces, good beer, great fish and chips.",
    goodReply:
      "Thanks, Linda. Friday regulars are a big part of this pub, and it's good to know the fish and chips and the beer are keeping up their end. See you on Friday.",
  },
  {
    id: "short-food",
    kind: "short",
    rating: 5,
    reviewerName: "Tom",
    reviewText: "Great food!",
    goodReply: "Thanks, Tom. Glad you enjoyed the food.",
  },
  {
    id: "short-service",
    kind: "short",
    rating: 5,
    reviewerName: null,
    reviewText: "Excellent service.",
    goodReply: "Thank you. I'll let the team know.",
  },
  {
    id: "star-only-five",
    kind: "rating_only",
    rating: 5,
    reviewerName: "Sam",
    reviewText: null,
    goodReply:
      "Hi Sam, thank you for the rating. Good to know you enjoyed your visit.",
  },
  {
    id: "star-only-two",
    kind: "rating_only",
    rating: 2,
    reviewerName: null,
    reviewText: null,
    goodReply:
      "Thank you for the rating. We are sorry your visit was not what it should have been. If you are willing to tell us what went wrong, please get in touch with us directly.",
  },
  {
    id: "detailed-occasion",
    kind: "detailed",
    rating: 5,
    reviewerName: "Rachel Okafor",
    reviewText:
      "Came for our 10th anniversary. Had the mushroom wellington and my husband had the roast beef, both excellent, and the sticky toffee pudding was the best I've had. Josh remembered it was our anniversary and brought a candle out with dessert. Lovely touch.",
    goodReply:
      "Thank you, Rachel, and happy anniversary to you both. Glad the mushroom wellington and the roast beef were both right, and that the sticky toffee pudding lived up to it. I'll tell Josh the candle was noticed.",
  },
  {
    id: "dietary",
    kind: "detailed",
    rating: 5,
    reviewerName: "Niamh",
    reviewText:
      "I'm coeliac and often nervous eating out. The staff checked everything with the kitchen and I had a gluten-free fish and chips that was actually good. Felt safe and well looked after.",
    goodReply:
      "Thanks, Niamh. Checking with the kitchen is exactly what the team should do, and I'm glad it meant you could relax. Good to hear the gluten-free fish and chips was worth ordering too.",
  },
  {
    id: "sensitive-illness",
    kind: "sensitive",
    rating: 1,
    reviewerName: "Paul",
    reviewText:
      "Three of us were ill the day after eating the chicken here. Reported it to the manager by phone and heard nothing back.",
    goodReply:
      "Paul, I'm sorry to read this, and sorry that you did not hear back after your call. This needs to be looked into properly. Please get in touch with us at the pub directly so I can take the details from you.",
  },
  {
    id: "sensitive-staff",
    kind: "sensitive",
    rating: 1,
    reviewerName: null,
    reviewText:
      "The barman was rude and made a comment about my accent. Felt unwelcome and left after one drink.",
    goodReply:
      "I'm sorry. Nobody should be made to feel unwelcome here, and what you describe is not acceptable. Please get in touch with us directly and tell me when you visited, so I can look into it.",
  },
]

/** Replies that must not pass, with the check that has to catch each. */
export const BAD_REPLIES: {
  id: string
  rating: number | null
  reviewText: string | null
  reply: string
  code: string
  severity: "fail" | "warn"
}[] = [
  {
    id: "third-person-summary",
    rating: 5,
    reviewText: "We come every week and love it.",
    reply:
      "The reviewer continues to enjoy multiple visits and will return again soon.",
    code: "third_person_summary",
    severity: "fail",
  },
  {
    id: "third-person-customer",
    rating: 4,
    reviewText: "Nice roast.",
    reply: "The customer enjoyed the roast and praised the service.",
    code: "third_person_summary",
    severity: "fail",
  },
  {
    id: "placeholder",
    rating: 5,
    reviewText: "Great food!",
    reply: "Hi [Customer Name], thanks for visiting [Restaurant Name].",
    code: "placeholder_text",
    severity: "fail",
  },
  {
    id: "meta",
    rating: 5,
    reviewText: "Great food!",
    reply: "Here is a reply you could post: Thanks for coming in.",
    code: "not_a_reply",
    severity: "fail",
  },
  {
    id: "incentive",
    rating: 1,
    reviewText: "Cold food.",
    reply:
      "Sorry about the cold food. Come back and your next meal is on the house.",
    code: "forbidden_promotion",
    severity: "fail",
  },
  {
    id: "drinks-on-us",
    rating: 1,
    reviewText: "Cold food.",
    reply: "Sorry about the cold food. Next time the drinks are on us.",
    code: "forbidden_promotion",
    severity: "fail",
  },
  {
    id: "refund",
    rating: 1,
    reviewText: "Cold food.",
    reply: "Sorry about the cold food. We will refund your bill in full.",
    code: "unsupported_commitment",
    severity: "fail",
  },
  {
    id: "asks-rating-change",
    rating: 2,
    reviewText: "Slow service.",
    reply:
      "Sorry about the wait. We hope you might reconsider your rating once you have tried us again.",
    code: "asks_rating_change",
    severity: "fail",
  },
  {
    id: "asks-for-review",
    rating: 5,
    reviewText: "Lovely.",
    reply: "Thanks. If you have a minute, please leave us a five star review.",
    code: "asks_rating_change",
    severity: "fail",
  },
  {
    id: "phone-number",
    rating: 1,
    reviewText: "Booking lost.",
    reply: "Sorry about the booking. Call me on 01223 567890.",
    code: "personal_contact_data",
    severity: "fail",
  },
  {
    id: "email",
    rating: 1,
    reviewText: "Booking lost.",
    reply:
      "Sorry about the booking. Email manager@example.com and I'll sort it.",
    code: "personal_contact_data",
    severity: "fail",
  },
  {
    id: "wrong-venue",
    rating: 5,
    reviewText: "Great food!",
    reply: "Thanks for visiting The Railway. Glad you enjoyed the food.",
    code: "wrong_location",
    severity: "fail",
  },
  {
    id: "profanity",
    rating: 1,
    reviewText: "Awful.",
    reply: "Sorry you thought it was shit.",
    code: "unsafe_language",
    severity: "fail",
  },
  {
    id: "stock-phrases",
    rating: 5,
    reviewText: "Great food!",
    reply:
      "Thank you for your review. We really appreciate your support. We hope to welcome you back soon.",
    code: "stock_phrase",
    severity: "warn",
  },
  {
    id: "exclamations",
    rating: 5,
    reviewText: "Great food!",
    reply: "Thanks so much! So glad you loved it! See you again!",
    code: "exclamation_overuse",
    severity: "warn",
  },
  {
    id: "complaint-brushed-off",
    rating: 1,
    reviewText: "Waited an hour and the food was cold.",
    reply: "Thanks for the feedback. We were very busy that night.",
    code: "complaint_not_acknowledged",
    severity: "warn",
  },
]

/** Harmless, professional sentences an earlier rule blocked. */
export const NOT_BLOCKED: { id: string; rating: number; reply: string }[] = [
  {
    id: "changed-the-menu",
    rating: 4,
    reply:
      "Thanks for the review. We changed the menu last month and it's good to hear the new pie is working.",
  },
  {
    id: "times-and-prices",
    rating: 4,
    reply:
      "Thanks. The kitchen is open 12.00 to 9.30pm, and the roast is £16.50 on Sundays.",
  },
  {
    id: "table-was-free",
    rating: 5,
    reply:
      "Thanks. Glad a table was free when you walked in, and feel free to ring ahead next time.",
  },
  {
    id: "that-is-on-us",
    rating: 2,
    reply: "We are sorry about the wait. That is on us, not on you.",
  },
  {
    id: "gluten-free",
    rating: 5,
    reply: "Thanks. Glad the gluten-free batter was worth ordering.",
  },
  {
    id: "year-range",
    rating: 5,
    reply: "Thanks. The 2026 - 2027 winter menu starts next month.",
  },
  {
    id: "five-stars-thanks",
    rating: 5,
    reply: "Thank you for the five stars. Glad you enjoyed the evening.",
  },
  {
    id: "the-guests-plural",
    rating: 5,
    reply:
      "Thanks. It's the guests who make a Friday night here, so it's good to hear you felt at home.",
  },
]
