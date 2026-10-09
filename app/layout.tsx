import localFont from "next/font/local"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

// The interface uses the platform sans and the serif stack declared in
// globals.css, so no web font is needed for either. JetBrains Mono is the
// one self-hosted family (OFL, licence beside the files in public/fonts):
// counts, timestamps, IDs and keycaps. `--font-mono` reads this variable.
const jetbrainsMono = localFont({
  src: [
    {
      path: "../public/fonts/jetbrains-mono/JetBrainsMono[wght].ttf",
      weight: "100 800",
      style: "normal",
    },
    {
      path: "../public/fonts/jetbrains-mono/JetBrainsMono-Italic[wght].ttf",
      weight: "100 800",
      style: "italic",
    },
  ],
  display: "swap",
  variable: "--font-jetbrains-mono",
  fallback: ["ui-monospace", "Menlo", "monospace"],
  adjustFontFallback: false,
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
        jetbrainsMono.variable
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
