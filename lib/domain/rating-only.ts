/**
 * The reply to a review that is a rating and nothing else. There is no
 * experience to answer, so the reply says thank you and stops; it assumes
 * nothing about the visit and uses none of the stock closing lines. A low
 * rating gets one plain apology and a way to say more.
 *
 * These go through the same rule checks and AI verification pass as any
 * other reply (lib/server/review-drafts.ts).
 */
const templates = {
  en: {
    positive: "Thank you for the rating. Good to know you enjoyed your visit.",
    neutral:
      "Thank you for the rating. If there is anything we could have done better, we would be glad to hear it.",
    negative:
      "Thank you for the rating. We are sorry your visit was not what it should have been. If you are willing to tell us what went wrong, please get in touch with us directly.",
  },
  de: {
    positive:
      "Vielen Dank für Ihre Bewertung. Schön, dass Ihnen Ihr Besuch gefallen hat.",
    neutral:
      "Vielen Dank für Ihre Bewertung. Wenn wir etwas hätten besser machen können, hören wir das gern.",
    negative:
      "Vielen Dank für Ihre Bewertung. Es tut uns leid, dass Ihr Besuch nicht so war, wie er hätte sein sollen. Wenn Sie uns sagen möchten, was nicht gestimmt hat, melden Sie sich bitte direkt bei uns.",
  },
  es: {
    positive:
      "Gracias por su valoración. Nos alegra saber que disfrutó de su visita.",
    neutral:
      "Gracias por su valoración. Si hay algo que podríamos haber hecho mejor, nos gustaría saberlo.",
    negative:
      "Gracias por su valoración. Sentimos que su visita no haya sido como debía. Si quiere contarnos qué falló, póngase en contacto con nosotros directamente.",
  },
  fr: {
    positive:
      "Merci pour votre note. Nous sommes contents que votre visite vous ait plu.",
    neutral:
      "Merci pour votre note. Si nous avions pu mieux faire, nous serions heureux de le savoir.",
    negative:
      "Merci pour votre note. Nous sommes désolés que votre visite n’ait pas été à la hauteur. Si vous souhaitez nous dire ce qui n’a pas été, contactez-nous directement.",
  },
  it: {
    positive:
      "Grazie per la sua valutazione. Ci fa piacere che la visita le sia piaciuta.",
    neutral:
      "Grazie per la sua valutazione. Se avessimo potuto fare qualcosa di meglio, ci farebbe piacere saperlo.",
    negative:
      "Grazie per la sua valutazione. Ci dispiace che la visita non sia stata come doveva. Se vuole dirci che cosa non ha funzionato, ci contatti direttamente.",
  },
} as const

const greetings = {
  en: "Hi",
  de: "Hallo",
  es: "Hola",
  fr: "Bonjour",
  it: "Buongiorno",
} as const

function reviewerGreeting(
  reply: string,
  reviewerName: string | null | undefined,
  language: keyof typeof templates
) {
  const name = reviewerName?.replace(/\s+/gu, " ").trim()
  if (!name || name.length > 80) return reply
  const personalizedReply =
    reply.charAt(0).toLocaleLowerCase(language) + reply.slice(1)
  return `${greetings[language]} ${name}, ${personalizedReply}`
}

export function ratingOnlyReply(
  rating: number | null,
  requestedLanguage: string,
  reviewerName?: string | null
) {
  const language = requestedLanguage.toLowerCase().split("-")[0]
  const supportedLanguage = language in templates ? language : "en"
  const group =
    rating === null || rating === 3
      ? "neutral"
      : rating >= 4
        ? "positive"
        : "negative"
  return {
    reply: reviewerGreeting(
      templates[supportedLanguage as keyof typeof templates][
        group as "positive" | "neutral" | "negative"
      ],
      reviewerName,
      supportedLanguage as keyof typeof templates
    ),
    language: supportedLanguage,
  }
}
