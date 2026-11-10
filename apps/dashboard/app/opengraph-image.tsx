import { OG_SIZE, OgCard } from "@skiffr/ui/brand/og-card"
import { ImageResponse } from "next/og"
import { SITE } from "@/lib/site"

export const alt = `${SITE.name} dashboard`
export const size = OG_SIZE
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    <OgCard name={SITE.name} title="Dashboard" description={SITE.tagline} colors={SITE.og} />,
    size,
  )
}
