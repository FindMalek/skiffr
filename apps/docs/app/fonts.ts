// Written by the design preset (findplate create --preset). Variables: --font-sans, --font-mono, --font-heading.
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google"

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })
const heading = IBM_Plex_Sans({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-heading" })

export const fontVariables = [sans.variable, mono.variable, heading.variable].join(" ")
