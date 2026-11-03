/**
 * An address that wraps after its "@" in a narrow column, so the domain
 * moves down whole instead of being cut mid-word ("stub@example.te / st").
 */
function EmailWithBreak({ email }: { email: string }) {
  const at = email.indexOf("@")
  if (at <= 0) return email
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  )
}

export { EmailWithBreak }
