import { GeistMono } from "geist/font/mono"
import { Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

// One family, platform-native. `--font-sans` in globals.css puts San
// Francisco first, so Apple devices never download a font; Inter is the
// fallback everywhere else because it carries an optical-size axis, which is
// what keeps 13px UI text open and 32px figures tight the way SF does.
// `adjustFontFallback` keeps the system fallback's metrics close enough that
// a slow font load does not reflow a heading.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-inter",
  fallback: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
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
        "font-sans antialiased",
        inter.variable,
        GeistMono.variable
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
