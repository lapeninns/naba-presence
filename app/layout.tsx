import localFont from "next/font/local"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const geist = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
})

const fontMono = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 900",
})

export const metadata = {
  title: "NabaReview · Google review operations",
  description:
    "Review, verify and publish trusted Google Business Profile responses.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
