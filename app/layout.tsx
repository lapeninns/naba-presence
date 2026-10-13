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
//
// Both faces are Latin WOFF2 subsets (public/fonts/jetbrains-mono/README.md),
// about 21 KB each instead of the 190 KB TTFs. The two calls share one
// family name, so italic mono text still finds its face. Only the upright
// face is preloaded: nothing sets mono italic today, and a preload would
// spend phone bandwidth on it ahead of the page's own scripts. (next/font
// takes only literals, so the shared family name is written out twice.)
const jetbrainsMono = localFont({
  src: "../public/fonts/jetbrains-mono/JetBrainsMono-Latin[wght].woff2",
  weight: "100 800",
  style: "normal",
  declarations: [{ prop: "font-family", value: "JetBrains Mono NP" }],
  display: "swap",
  variable: "--font-jetbrains-mono",
  fallback: ["ui-monospace", "Menlo", "monospace"],
  adjustFontFallback: false,
})

const jetbrainsMonoItalic = localFont({
  src: "../public/fonts/jetbrains-mono/JetBrainsMono-Latin-Italic[wght].woff2",
  weight: "100 800",
  style: "italic",
  declarations: [{ prop: "font-family", value: "JetBrains Mono NP" }],
  display: "swap",
  preload: false,
  // Unused by any rule; declaring it keeps this call's @font-face in the
  // stylesheet alongside the upright one.
  variable: "--font-jetbrains-mono-italic",
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
      className={cn(
        "font-sans antialiased",
        jetbrainsMono.variable,
        jetbrainsMonoItalic.variable
      )}
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
