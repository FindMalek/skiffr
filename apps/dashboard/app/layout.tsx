import "@skiffr/ui/globals.css"
import { QueryProvider } from "@skiffr/orpc/react"
import { Toaster } from "@skiffr/ui/components/sonner"
import { TooltipProvider } from "@skiffr/ui/components/tooltip"
import { cn } from "@skiffr/ui/lib/utils"
import type { Metadata, Viewport } from "next"
import Script from "next/script"
import { ThemeProvider } from "@/components/theme-provider"
import { dashboardUrl, SITE } from "@/lib/site"
import { fontVariables } from "./fonts"
import "./shell.css"

// Prerendered pages would bake the build-time DASHBOARD_URL into `metadataBase`.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  metadataBase: new URL(dashboardUrl()),
  title: { default: "Dashboard", template: "%s · skiffr" },
  description: SITE.tagline,
  openGraph: { title: `${SITE.name} dashboard`, description: SITE.tagline, siteName: SITE.name },
  twitter: { card: "summary_large_image" },
  robots: { index: false, follow: false },
}

/** `viewport-fit=cover` lets the tab bar and the toasts use the safe-area inset on a phone. */
export const viewport: Viewport = { viewportFit: "cover" }

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const page = { lang: "en" }
  return (
    <html lang={page.lang} suppressHydrationWarning className={cn("antialiased", fontVariables, "font-sans")}>
      <body className="bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-skip focus:border focus:border-border-strong focus:bg-background focus:px-3 focus:py-2 focus:font-medium focus:text-foreground focus:text-sm"
        >
          Skip to content
        </a>
        <Script src="/analytics.js" strategy="afterInteractive" />
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryProvider>
          <Toaster
            position="bottom-right"
            visibleToasts={3}
            duration={5000}
            offset={{ bottom: "var(--toast-bottom)", right: "1rem" }}
            mobileOffset={{ bottom: "var(--toast-bottom)", left: "1rem", right: "1rem" }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
