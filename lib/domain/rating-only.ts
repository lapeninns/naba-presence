const templates = {
  en: {
    positive: "Thank you for your rating. We hope to welcome you again.",
    neutral:
      "Thank you for your rating. We appreciate your feedback and hope to welcome you again.",
    negative:
      "Thank you for your rating. We’re sorry your experience fell short of expectations.",
  },
  de: {
    positive:
      "Vielen Dank für Ihre Bewertung. Wir hoffen, Sie bald wieder begrüßen zu dürfen.",
    neutral:
      "Vielen Dank für Ihre Bewertung. Wir schätzen Ihr Feedback und hoffen, Sie wieder begrüßen zu dürfen.",
    negative:
      "Vielen Dank für Ihre Bewertung. Es tut uns leid, dass Ihr Erlebnis nicht Ihren Erwartungen entsprach.",
  },
  es: {
    positive:
      "Gracias por su valoración. Esperamos darle la bienvenida de nuevo.",
    neutral:
      "Gracias por su valoración. Agradecemos sus comentarios y esperamos volver a recibirle.",
    negative:
      "Gracias por su valoración. Sentimos que su experiencia no haya estado a la altura de sus expectativas.",
  },
  fr: {
    positive:
      "Merci pour votre note. Nous espérons avoir le plaisir de vous accueillir à nouveau.",
    neutral:
      "Merci pour votre note. Nous apprécions votre retour et espérons vous accueillir à nouveau.",
    negative:
      "Merci pour votre note. Nous sommes désolés que votre expérience n’ait pas répondu à vos attentes.",
  },
  it: {
    positive:
      "Grazie per la sua valutazione. Speriamo di poterla accogliere nuovamente.",
    neutral:
      "Grazie per la sua valutazione. Apprezziamo il suo feedback e speriamo di accoglierla di nuovo.",
    negative:
      "Grazie per la sua valutazione. Ci dispiace che la sua esperienza non sia stata all’altezza delle aspettative.",
  },
} as const

export function ratingOnlyReply(rating: number, requestedLanguage: string) {
  const language = requestedLanguage.toLowerCase().split("-")[0]
  const supportedLanguage = language in templates ? language : "en"
  const group = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative"
  return {
    reply:
      templates[supportedLanguage as keyof typeof templates][
        group as "positive" | "neutral" | "negative"
      ],
    language: supportedLanguage,
  }
}
