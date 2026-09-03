function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow?: React.ReactNode
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex w-full max-w-md flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        {eyebrow ? (
          <p className="text-caption font-semibold text-primary">{eyebrow}</p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <h1 className="text-page-title font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {description ? (
            <p className="text-body text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-5">{children}</div>

      {footer ? (
        <div className="text-center text-ui text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </main>
  )
}

export { AuthCard }
