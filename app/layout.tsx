import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Newsreader } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

// The editorial voice: Newsreader carries page titles and display numbers,
// Geist everything else. `adjustFontFallback` keeps the Georgia fallback close
// enough in metrics that a slow font load does not reflow a heading, and PDF
// or PNG exports of a page render that fallback rather than nothing.
const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-newsreader",
  fallback: ["Georgia", "Times New Roman", "serif"],
})

export const metadata = {
  title: "NabaPresence · Google review operations",
  description:
    "Nab a Presence. Review, verify and publish trusted Google Business Profile responses.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased font-sans",
        GeistSans.variable,
        GeistMono.variable,
        newsreader.variable
      )}
    >
      <body>
        <ThemeProvider>
          <Toaster>{children}</Toaster>
        </ThemeProvider>
      </body>
    </html>
  )
}
