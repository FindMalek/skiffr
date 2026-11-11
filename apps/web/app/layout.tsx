import "@skiffr/ui/globals.css"
import { QueryProvider } from "@skiffr/orpc/react"
import { cn } from "@skiffr/ui/lib/utils"
import type { Metadata } from "next"
import { ThemeProvider } from "@/components/theme-provider"
import { siteUrl } from "@/lib/seo"
import { SITE } from "@/lib/site"
import { fontVariables } from "./fonts"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE.name} | Job application autofill that learns`, template: `%s | ${SITE.name}` },
  description: SITE.tagline,
  alternates: { canonical: "./" },
  openGraph: {
    title: `${SITE.name} | Job application autofill that learns`,
    description: SITE.tagline,
    type: "website",
    siteName: SITE.name,
    url: "./",
  },
  twitter: { card: "summary_large_image" },
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const page = { lang: "en" }
  return (
    <html lang={page.lang} suppressHydrationWarning className={cn("h-full antialiased", fontVariables, "font-sans")}>
      <body className="relative flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider>
          <QueryProvider>
            <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
              <div className="absolute inset-x-0 top-0 h-128 bg-glow" />
              <div className="absolute inset-0 bg-dots" />
            </div>
            {children}
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
