import "@skiffr/ui/globals.css"
import { QueryProvider } from "@skiffr/orpc/react"
import { Toaster } from "@skiffr/ui/components/sonner"
import { TooltipProvider } from "@skiffr/ui/components/tooltip"
import { cn } from "@skiffr/ui/lib/utils"
import type { Metadata } from "next"
import Script from "next/script"
import { ThemeProvider } from "@/components/theme-provider"
import { dashboardUrl, SITE } from "@/lib/site"
import { fontVariables } from "./fonts"

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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const page = { lang: "en" }
  return (
    <html lang={page.lang} suppressHydrationWarning className={cn("antialiased", fontVariables, "font-sans")}>
      <body className="bg-background text-foreground">
        <Script src="/analytics.js" strategy="afterInteractive" />
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
