import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"

function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main id="main" tabIndex={-1} className="w-full max-w-md">
      <Card>
        <CardHeader className="gap-1.5">
          <h1 className="text-page-title font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
      {footer ? (
        <div className="mt-4 text-center text-ui text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </main>
  )
}

export { AuthCard }
