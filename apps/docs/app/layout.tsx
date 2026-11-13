import "./globals.css"
import { cn } from "@skiffr/ui/lib/utils"
import { RootProvider } from "fumadocs-ui/provider/next"
import type { Metadata } from "next"
import Script from "next/script"
import { SITE } from "@/lib/site"
import { fontVariables } from "./fonts"

export const metadata: Metadata = {
  metadataBase: new URL(process.env.DOCS_URL ?? "http://localhost:3003"),
  title: { default: `${SITE.name} docs`, template: `%s | ${SITE.name}` },
  description: SITE.tagline,
  twitter: { card: "summary_large_image" },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("antialiased", fontVariables, "font-sans")}>
      <body className="flex min-h-screen flex-col">
        <Script src="/analytics.js" strategy="afterInteractive" />
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
