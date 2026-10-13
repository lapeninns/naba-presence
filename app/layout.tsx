import type { Viewport } from "next"
import localFont from "next/font/local"

import "./globals.css"
import { ViewportInsets } from "@/components/app-shell/viewport-insets"
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

// Next writes width=device-width, initial-scale=1 itself; these are the
// additions a phone-first shell needs.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page draw under the notch and home indicator, which is what
  // makes env(safe-area-inset-*) non-zero; the shell pads itself back in.
  viewportFit: "cover",
  // Android Chrome shrinks the layout viewport for the keyboard, so fixed
  // bottom bars sit above it. iOS ignores this and overlays the keyboard;
  // <ViewportInsets> covers that case with --np-keyboard-inset.
  interactiveWidget: "resizes-content",
  // The browser chrome matches the canvas (--np-surface-canvas). Hex because
  // not every browser takes oklch here: #f6f9fc ≈ oklch(0.98 0.005 250),
  // #0d1216 ≈ oklch(0.18 0.012 240). These follow the system preference; a
  // user who forces the other theme in-app keeps the system's bar colour.
  // design-exempt-start R2: meta theme-color is read before any CSS loads
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1216" },
  ],
  // design-exempt-end
  // Both schemes are built (globals.css sets color-scheme per theme class),
  // so the browser may draw its pre-CSS canvas and form controls in either.
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans antialiased", jetbrainsMono.variable)}
    >
      <body>
        <ViewportInsets />
        <ThemeProvider>
          <Toaster>{children}</Toaster>
        </ThemeProvider>
      </body>
    </html>
  )
}
