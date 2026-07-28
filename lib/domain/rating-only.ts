const templates = {
  en: {
    positive:
      "Thank you for your rating. We really appreciate your support and hope to welcome you back soon.",
    neutral:
      "Thank you for your rating. We appreciate you taking the time to share it and hope to make your next visit even better.",
    negative:
      "Thank you for taking the time to rate your experience. We’re sorry it fell short of expectations. If you’re willing, please contact the property directly so we can better understand what happened.",
  },
  de: {
    positive:
      "Vielen Dank für Ihre Bewertung. Wir wissen Ihre Unterstützung sehr zu schätzen und hoffen, Sie bald wieder begrüßen zu dürfen.",
    neutral:
      "Vielen Dank für Ihre Bewertung. Wir schätzen es, dass Sie sich die Zeit dafür genommen haben, und hoffen, Ihren nächsten Aufenthalt noch besser zu gestalten.",
    negative:
      "Vielen Dank, dass Sie sich die Zeit für eine Bewertung genommen haben. Es tut uns leid, dass Ihr Erlebnis nicht Ihren Erwartungen entsprach. Wenn Sie möchten, wenden Sie sich bitte direkt an das Hotel, damit wir besser verstehen können, was passiert ist.",
  },
  es: {
    positive:
      "Gracias por su valoración. Agradecemos mucho su apoyo y esperamos volver a darle la bienvenida pronto.",
    neutral:
      "Gracias por su valoración. Agradecemos que se haya tomado el tiempo de compartirla y esperamos que su próxima visita sea aún mejor.",
    negative:
      "Gracias por tomarse el tiempo de valorar su experiencia. Sentimos que no haya estado a la altura de sus expectativas. Si lo desea, póngase en contacto directamente con el hotel para que podamos comprender mejor lo ocurrido.",
  },
  fr: {
    positive:
      "Merci pour votre note. Votre soutien nous fait très plaisir et nous espérons vous accueillir à nouveau bientôt.",
    neutral:
      "Merci pour votre note. Nous vous remercions d’avoir pris le temps de la partager et espérons rendre votre prochaine visite encore meilleure.",
    negative:
      "Merci d’avoir pris le temps de noter votre expérience. Nous sommes désolés qu’elle n’ait pas répondu à vos attentes. Si vous le souhaitez, contactez directement l’établissement afin que nous puissions mieux comprendre ce qui s’est passé.",
  },
  it: {
    positive:
      "Grazie per la sua valutazione. Apprezziamo molto il suo sostegno e speriamo di accoglierla nuovamente presto.",
    neutral:
      "Grazie per la sua valutazione. Apprezziamo il tempo che ci ha dedicato e speriamo di rendere la sua prossima visita ancora migliore.",
    negative:
      "Grazie per aver dedicato del tempo a valutare la sua esperienza. Ci dispiace che non sia stata all’altezza delle aspettative. Se lo desidera, contatti direttamente la struttura così potremo capire meglio cosa è successo.",
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
  rating: number,
  requestedLanguage: string,
  reviewerName?: string | null
) {
  const language = requestedLanguage.toLowerCase().split("-")[0]
  const supportedLanguage = language in templates ? language : "en"
  const group = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative"
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
