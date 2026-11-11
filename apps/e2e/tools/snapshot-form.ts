import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const [url, name] = process.argv.slice(2)
if (!url || !name) {
  console.error("usage: pnpm --filter e2e snapshot <url> <fixture-name>")
  process.exit(1)
}

const browser = await chromium.launch({ channel: "chromium" })
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "networkidle" })
  // keep the markup the detector reads (labels, names, aria, structure) and drop everything that can run or phone home
  const html = await page.evaluate(() => {
    const root = document.querySelector("form") ?? document.body
    const copy = root.cloneNode(true) as HTMLElement
    for (const el of copy.querySelectorAll("script, style, link, iframe, noscript, svg, img, picture, video"))
      el.remove()
    for (const el of copy.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("on") || attr.name === "style" || attr.name === "srcset") el.removeAttribute(attr.name)
        if (attr.name === "action" || attr.name === "href") el.setAttribute(attr.name, "#")
      }
      if (el instanceof HTMLInputElement && el.type !== "radio" && el.type !== "checkbox") el.removeAttribute("value")
    }
    return copy.outerHTML
  })
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "pages", "ats", `${name}.html`)
  writeFileSync(
    file,
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${name} snapshot</title></head>\n<body>\n${html}\n</body>\n</html>\n`,
  )
  console.log(`wrote ${file}`)
} finally {
  await browser.close()
}
